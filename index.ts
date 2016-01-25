/// <reference path="./typings/tsd.d.ts"/>
/// <reference path="./lib/connect.d.ts"/>

import {RedisClient} from 'redis';
import * as Promise from 'bluebird';
import * as crypto from 'crypto';

import connect from './lib/connect';
import {RequestHandler} from 'express';

export default class RedisSessionsAnywhere<S> {
    constructor(public client: RedisClient, public options?: NewOptions) {
        if (!client) {
            throw new Error('Client is not redis client!');
        }
        this.options = merge<NewOptions>({
            prefix: 'resa:',
            ttl: 24 * 60 * 60 * 1000, // our data will expire in one day

            lock: false, // sets a lock before setting data, so data isn't overwritten
            lockSuffix: ':lock',
            lockTtl: 80 * 1000, // our lock will time out in 8 seconds
            lockRetry: 50 // retry in 50ms
        }, this.options);
    }

    public get(token: string): Promise<SessionObject<S>> {
        if (!token || typeof token !== 'string') {
            throw new Error('Token must be valid string');
        }
        return new Promise<SessionObject<S>>((resolve, reject) => {
            this.client.get(this.options.prefix + token, (error, reply) => {
                if (error) {
                    return reject(error);
                }
                if (!reply) {
                    return resolve(null);
                }
                let parsed: SessionStorageObject<S>;
                try {
                    parsed = JSON.parse(reply);
                } catch (error) {
                    return reject(error);
                }
                let object: SessionObject<S> = {} as any;
                object.timeLeft = parsed.time - Date.now();
                object.data = parsed.data;
                resolve(object);
            });
        });
    }

    public set(token: string, values?: S): Promise<SessionObject<S>> {
        if (!token || typeof token !== 'string') {
            throw new Error('Token must be valid string');
        }
        if (this.options.lock) {
            // get our lock before setting
            return new Promise<SessionObject<S>>((resolve, reject) => {
                this.getLock(token, (error, unlock) => {
                    if (error) {
                        return reject(error);
                    }
                    let data: SessionObject<S>;
                    // unlock so that it skips this
                    this.options.lock = false;
                    let promise = this.set(token, values);
                    this.options.lock = true;
                    resolve(promise.then((object: SessionObject<S>) => {
                        data = object;
                        return unlock();
                    }).then(() => data));
                });
            });
        }
        if (!values) {
            values = {} as S;
        }
        let session: SessionStorageObject<S> = {
            time: Date.now() + this.options.ttl,
            data: values
        };
        return new Promise<SessionObject<S>>((resolve, reject) => {
            this.client.set([this.options.prefix + token, JSON.stringify(session), 'PX', this.options.ttl], error => {
                if (error) {
                    return reject(error);
                }
                let object: SessionObject<S> = {
                    timeLeft: this.options.ttl,
                    data: values
                };
                resolve(object);
            });
        });
    }

    public delete(token: string): Promise<void> {
        if (!token || typeof token !== 'string') {
            throw new Error('Token must be valid string');
        }
        if (this.options.lock) {
            return new Promise<void>((resolve, reject) => {
                this.getLock(token, (error, unlock) => {
                    if (error) {
                        return reject(error);
                    }
                    // temp unlock
                    this.options.lock = false;
                    let promise = this.delete(token);
                    this.options.lock = true;
                    resolve(promise.then(unlock));
                });
            });
        }
        return new Promise<void>((resolve, reject) => {
            this.client.del(this.options.prefix + token, (error) => {
                if (error) {
                    return reject(error);
                }
                resolve(null);
            });
        });
    }

    private getLock(token: string, callback: (error: Error, unlock?: () => Promise<void>) => any) {
        let lockKey: string = this.options.prefix + token + this.options.lockSuffix;
        let attemptLock = () => {
            this.client.set([lockKey, 'L', 'NX', 'PX', this.options.lockTtl], (error, result) => {
                if (error) {
                    return callback(error);
                }
                if (!result) {
                    return setTimeout(() => attemptLock(), this.options.lockRetry);
                }
                callback(null, unlock); // we're good to go
            });
        }

        let unlock = (): Promise<void> => {
            return new Promise<void>((resolve, reject) => {
                this.client.del(lockKey, (error) => {
                    if (error) {
                        return callback(error);
                    }
                    resolve(null); // we're finally done
                });
            });
        }
        attemptLock();
    }
}

// export it here for the sake of typescript, but it gets overwritten down below
export class TokenGenerator {
    constructor(private sessions: RedisSessionsAnywhere<any>, private options: TokenGeneratorOptions) {
        if (!options.key || typeof options.key !== 'string') {
            throw new Error('Invalid key');
        }
        this.options = merge<TokenGeneratorOptions>({
            key: '',
            tokenBytes: 16,
            checkForCollision: true
        }, options);
    }

    public generateClientToken(token: Buffer | string): string {
        if (!Buffer.isBuffer(token)) {
            token = new Buffer(token as string, 'hex');
        }
        // create our two keys
        let hmac: crypto.Hmac = crypto.createHmac('sha256', this.options.key);
        hmac.update('resa-enc');
        let encryptionKey = hmac.digest();

        hmac = crypto.createHmac('sha256', this.options.key);
        hmac.update('resa-mac');
        let signatureKey = hmac.digest();

        // generate our iv and final str
        let iv: Buffer = crypto.randomBytes(16);
        let str: Buffer = new Buffer(token.toString('hex') + '|' + (Date.now() + this.sessions.options.ttl), 'utf8');
        emptyBuffer(token as Buffer); // we empty our buffers as a security measure

        let cipher: crypto.Cipher = crypto.createCipheriv('aes256', encryptionKey, iv);
        let bufferOne = cipher.update(str);
        emptyBuffer(str);
        let bufferTwo = cipher.final();
        let buffer: Buffer = Buffer.concat([bufferOne, bufferTwo]);
        emptyBuffer(bufferOne);
        emptyBuffer(bufferTwo);

        hmac = crypto.createHmac('sha256', signatureKey);
        hmac.update(iv);
        hmac.update('.');
        hmac.update(buffer);
        let hmacResult: Buffer = hmac.digest();
        let generated: string = base64urlencode(iv) + '.' + base64urlencode(buffer) + '.' + base64urlencode(hmacResult);

        return generated;
    }

    public generateKey(): Promise<TokenAndClientToken> {
        if (!this.options.checkForCollision) {
            let token: Buffer = crypto.randomBytes(this.options.tokenBytes);
            return Promise.resolve({
                token: token.toString('hex'),
                clientToken: this.generateClientToken(token)
            });
        }

        let next: () => Promise<TokenAndClientToken> = () => {
            let token: Buffer = crypto.randomBytes(this.options.tokenBytes);
            let tokenString = token.toString('hex');
            return new Promise<TokenAndClientToken>((resolve, reject) => {
                this.sessions.client.exists(tokenString, (error, exists) => {
                    if (error) {
                        return reject(error);
                    }
                    if (exists) {
                        return resolve(next());
                    }
                    resolve({
                        token: token.toString('hex'),
                        clientToken: this.generateClientToken(token)
                    });
                });
            });
        };

        return next();
    }

    public parseClientToken(token: string): ClientToken {
        let components: string[] = token.split('.');
        if (components.length !== 3) {
            throw new Error('Invalid component length');
        }
        let iv: Buffer;
        let buffer: Buffer;
        let hmacResult: Buffer;
        let expectedHmac: Buffer;
        let encryptionKey: Buffer;
        let signatureKey: Buffer;
        try {
            // create our two keys
            let hmac: crypto.Hmac = crypto.createHmac('sha256', this.options.key);
            hmac.update('resa-enc');
            encryptionKey = hmac.digest();

            hmac = crypto.createHmac('sha256', this.options.key);
            hmac.update('resa-mac');
            signatureKey = hmac.digest();

            iv = base64urldecode(components[0]);
            buffer = base64urldecode(components[1]);
            hmacResult = base64urldecode(components[2]);
            if (iv.length !== 16) {
                throw new Error('Invalid iv length');
            }

            // check expected hmac
            hmac = crypto.createHmac('sha256', signatureKey);
            hmac.update(iv);
            hmac.update('.');
            hmac.update(buffer);
            expectedHmac = hmac.digest();
            if (!buffersEqual(expectedHmac, hmacResult)) {
                clean();
                throw new Error('hmac does not match');
            }

            let cipher = crypto.createDecipheriv('aes256', encryptionKey, iv);
            let str: string = cipher.update(buffer).toString('utf8');
            str += cipher.final('utf8');

            let split = str.split('|');
            if (split.length !== 2) {
                throw new Error('Original contents have been modified');
            }
            let token: string = split[0];
            let expiresAt: number = +split[1];

            clean();
            return {
                token: token,
                expiresAt: expiresAt
            };
        } catch (err) {
            throw err;
        }

        function clean() {
            emptyBuffer(iv);
            emptyBuffer(buffer);
            emptyBuffer(hmacResult);
            emptyBuffer(expectedHmac);
            emptyBuffer(encryptionKey);
            emptyBuffer(signatureKey);
        }
    }

    public isValid(token: string | ClientToken): boolean {
        try {
            let parsed: ClientToken;
            if (typeof token === 'string') {
                parsed = this.parseClientToken(token);
            } else {
                parsed = token;
            }
            return Date.now() < parsed.expiresAt;
        } catch (err) {
            // todo maybe some way of passing this back?
            return false;
        }
    }

    public connect(options?: ConnectOptions): RequestHandler {
        return connect(this.sessions as any, this as any, options);
    }
}

function merge<T>(original: T, object: any): T {
    if (object) {
        for (let property in object) {
            original[property] = object[property];
        }
    }
    return original;
}

// taken from https://github.com/mozilla/node-client-sessions/blob/master/lib/client-sessions.js
function buffersEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let ret = 0;
    for (let i = 0; i < a.length; i++) {
        ret |= a.readUInt8(i) ^ b.readUInt8(i);
    }
    return ret === 0;
}

function base64urlencode(arg: Buffer): string {
    let s: string = arg.toString('base64');
    s = s.split('=')[0]; // Remove any trailing '='s
    s = s.replace(/\+/g, '-'); // 62nd char of encoding
    s = s.replace(/\//g, '_'); // 63rd char of encoding
    // TODO optimize this; we can do much better
    return s;
}

function base64urldecode(arg: string): Buffer {
    var s = arg;
    s = s.replace(/-/g, '+'); // 62nd char of encoding
    s = s.replace(/_/g, '/'); // 63rd char of encoding
    switch (s.length % 4) { // Pad with trailing '='s
        case 0:
            break; // No pad chars in this case
        case 2:
            s += "==";
            break; // Two pad chars
        case 3:
            s += "=";
            break; // One pad char
        default:
            throw new Error("Illegal base64url string!");
    }
    return new Buffer(s, 'base64'); // Standard base64 decoder
}


function emptyBuffer(buffer: Buffer) {
    if (buffer) {
        for (let i = 0, length = buffer.length; i < length; i++) {
            buffer[i] = 0;
        }
    }
}

interface SessionStorageObject<S> {
    time: number;
    data: S;
}

export interface SessionObject<S> {
    timeLeft: number;
    data: S;
}

export interface NewOptions {
    prefix: string;
    ttl: number;

    lock: boolean;
    lockSuffix: string;
    lockTtl: number;
    lockRetry: number;
}

export interface TokenGeneratorOptions {
    key: string;
    tokenBytes: number;
    checkForCollision: boolean;
}

export interface TokenAndClientToken {
    token: string;
    clientToken: string;
}

export interface ClientToken {
    token: string;
    expiresAt: number;
}

export interface ConnectOptions {
    cookieName: string;
    alwaysUpdate: boolean;
}

module.exports = RedisSessionsAnywhere; // the actual export
module.exports.default = RedisSessionsAnywhere; // set the default for ES6 modules or typescript
module.exports.__esModule = true; // define it as a module
module.exports.TokenGenerator = TokenGenerator; // and last, reexport our TokenGenerator
