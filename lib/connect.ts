/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="session.d.ts"/>

import {Request, Response, RequestHandler} from 'express';
import RedisSessionsAnywhere, {SessionObject, TokenGenerator, TokenAndClientToken, ClientToken, ConnectOptions} from '../';

let debug = require('debug')('resa:Connect');

export default function connect(sessions: RedisSessionsAnywhere<any>, generator: TokenGenerator, options?: ConnectOptions): RequestHandler {
    options = merge<ConnectOptions>({
        cookieName: 'resa',
        alwaysUpdate: false,
        sessionKey: 'session'
    }, options);
    return (request: Request, response: Response, next: Function) => {
        let clientToken: string;
        let token: string;
        let generated = false;

        let previousEnd = response.end;
        let originalSession;
        response.end = function() {
            // todo check if session data changed
            let shouldUpdate: boolean = options.alwaysUpdate || generated;
            if (!shouldUpdate) {
                // we can do better, but for now this is a good json check
                shouldUpdate = JSON.stringify(originalSession) !== JSON.stringify(request[options.sessionKey]);
            }
            let args = arguments;
            let instance = response;
            if (!shouldUpdate) {
                return finishUp(false, arguments, instance);
            }
            sessions.set(token, request[options.sessionKey]).then(() => {
                // update our client token
                clientToken = generator.generateClientToken(token);
                finishUp(true, args, instance);
            });
        };

        if (request.signedCookies[options.cookieName]) {
            clientToken = request.signedCookies[options.cookieName];
            let parsed: ClientToken;
            try {
                parsed = generator.parseClientToken(clientToken);
            } catch (err) {
                debug('Error parsing token', err);
                return next(new Error('Invalid token'));
            }
            if (!generator.isValid(parsed)) {
                return next(new Error('Token has expired'));
            }
            token = parsed.token;
            return update();
        }

        // no token, let's generate one
        generator.generateKey().then((key: TokenAndClientToken) => {
            token = key.token;
            clientToken = key.clientToken;
            generated = true;
            update();
        });

        function update() {
            sessions.get(token).then((session: SessionObject<any>) => {
                let data = session ? session.data : {};
                data._token = token;
                request[options.sessionKey] = data;
                originalSession = merge({}, data);
                next(); // we're done here, until the request is finished
            });
        }

        function finishUp(updated: boolean, args: any, instance: any) {
            if (updated) {
                setCookie();
            }
            previousEnd.apply(instance, args);
        }

        function setCookie() {
            response.cookie(options.cookieName, clientToken, {signed: true, maxAge: sessions.options.ttl});
        }
    };
};

function merge<T>(original: T, object: any): T {
    if (object) {
        for (let property in object) {
            original[property] = object[property];
        }
    }
    return original;
}
