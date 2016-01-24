/// <reference path="./typings/tsd.d.ts"/>

import {RedisClient} from 'redis';
import * as Promise from 'bluebird';

class RedisSessionsAnywhere<S> {
    constructor(private client: RedisClient, private options?: NewOptions) {
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
                    return resolve(this.set(token, {} as S));
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
}

function merge<T>(original: T, object: any): T {
    if (object) {
        for (let property in object) {
            original[property] = object[property];
        }
    }
    return original;
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

export default RedisSessionsAnywhere; // we override this in the next line, but ts code reading this exact file depends on it
module.exports = RedisSessionsAnywhere; // the actual export
module.exports.default = RedisSessionsAnywhere; // set the default for ES6 modules or typescript
module.exports.__esModule = true; // define it as a module
