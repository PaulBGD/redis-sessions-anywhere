/// <reference path="../typings/tsd.d.ts"/>

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

        let previousEnd = (response as any)._storeHeader;
        let originalSession;
        (response as any)._storeHeader = function() {
            // todo check if session data changed
            let shouldUpdate: boolean = options.alwaysUpdate || generated;
            if (!shouldUpdate) {
                // we can do better, but for now this is a good json check
                shouldUpdate = JSON.stringify(originalSession) !== JSON.stringify(request[options.sessionKey]);
            }
            let instance = response;
            if (!shouldUpdate) {
                return finishUp(arguments, instance);
            }
            delete request[options.sessionKey]._token; // we don't need this now
            if (options.alwaysUpdate) {
                clientToken = generator.generateClientToken(token);
                setCookie();
            }
            finishUp(arguments, instance);
            sessions.set(token, request[options.sessionKey]).catch(debug);
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
            setCookie();
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

        function finishUp(args: any, instance: any) {
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
