'use strict';

require('source-map-support').install();

let assert = require('assert');
let redis = require('redis');
let RedisSessions = require('../');
let TokenGenerator = RedisSessions.TokenGenerator;

describe('redis-sessions-anywhere', () => {
    let client = redis.createClient();
    let token = Math.random().toString();

    describe('simple', () => {
        // todo split these up?
        it('can run a simple set of tests', () => {
            let sessions = new RedisSessions(client);
            return sessions.set(token, {dummy: true})
                .then((object) => {
                    assert(object, 'An object is not returned');
                    assert(object.data, 'The object does not contain the data');
                    assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                    assert.equal(object.timeLeft, sessions.options.ttl, 'The time left is not equal to the ttl');

                    return sessions.get(token);
                })
                .then((object) => {
                    assert(object, 'An object is not returned');
                    assert(object.data, 'The object does not contain the data');
                    assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                    assert(object.timeLeft <= sessions.options.ttl, 'The time left is more than the ttl');
                    assert(object.timeLeft > 0, 'The time left is less than 0');

                    return sessions.delete(token);
                })
                .then(() => {
                    return sessions.get(token);
                })
                .then((object) => {
                    assert.deepEqual({}, object.data, 'Returns empty object')
                })
                .catch(err => {
                    throw err;
                });
        });

        // todo do actual tests on locking
        it('can run the same tests but with locking', () => {
            let sessions = new RedisSessions(client, {
                lock: true
            });
            return sessions.set(token, {dummy: true})
                .then((object) => {
                    assert(object, 'An object is not returned');
                    assert(object.data, 'The object does not contain the data');
                    assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                    assert.equal(object.timeLeft, sessions.options.ttl, 'The time left is not equal to the ttl');

                    return sessions.get(token);
                })
                .then((object) => {
                    assert(object, 'An object is not returned');
                    assert(object.data, 'The object does not contain the data');
                    assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                    assert(object.timeLeft <= sessions.options.ttl, 'The time left is more than the ttl');
                    assert(object.timeLeft > 0, 'The time left is less than 0');

                    return sessions.delete(token);
                })
                .then(() => {
                    return sessions.get(token);
                })
                .then((object) => {
                    assert.deepEqual({}, object.data, 'Returns empty object')
                })
                .catch(err => {
                    throw err;
                });
        });
    });

    describe('token generation', () => {
        it('can generate a token then check it', () => {
            let sessions = new RedisSessions(client);
            let generator = new TokenGenerator(sessions, {
                key: 'adwadwadawdawdawdawadwadaaaaaaaaaaaaaaaaaaaaaaaaaaawdwadwwaddawdadw',
                checkForCollission: false // we're not testing this right now
            });
            return generator.generateKey().then(key => {
                assert.notEqual(null, key, 'key is not returned');
                assert(key.token.length === 32, 'length of token is not 32');
                let parsed = generator.parseClientToken(key.clientToken);
                assert(parsed.token === key.token, 'key is not the same');
                assert(Date.now() - parsed.expiresAt <= sessions.options.ttl, 'the time left is more than the ttl');
                assert(generator.isValid(key.clientToken), 'the token is not valid');
            });
        });

        it('can check for collission', () => {
            let sessions = new RedisSessions(client);
            let generator = new TokenGenerator(sessions, {
                key: 'adwadwadawdawdawdawadwadaaaaaaaaaaaaaaaaaaaaaaaaaaawdwadwwaddawdadw'
            });
            return generator.generateKey();
        });
    });

    afterEach((done) => {
        client.del(['resa:' + token, 'resa:' + token + ':lock'], done);
    });

    after(() => {
        client.quit();
    });

});
