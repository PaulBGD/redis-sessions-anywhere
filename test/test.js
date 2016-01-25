'use strict';

require('source-map-support').install();
var Promise = require('bluebird');
var request = require('request-promise');

var assert = require('assert');
var redis = require('redis');
var RedisSessions = require('../index.js');
var TokenGenerator = RedisSessions.TokenGenerator;

var express = require('express');
var cookieParser = require('cookie-parser');

describe('redis-sessions-anywhere', function () {
    var client = redis.createClient();
    var token = Math.random().toString();

    describe('simple', function () {
        // todo split these up?
        it('can run a simple set of tests', function () {
            var sessions = new RedisSessions(client);
            return sessions.set(token, { dummy: true }).then(function (object) {
                assert(object, 'An object is not returned');
                assert(object.data, 'The object does not contain the data');
                assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                assert.equal(object.timeLeft, sessions.options.ttl, 'The time left is not equal to the ttl');

                return sessions.get(token);
            }).then(function (object) {
                assert(object, 'An object is not returned');
                assert(object.data, 'The object does not contain the data');
                assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                assert(object.timeLeft <= sessions.options.ttl, 'The time left is more than the ttl');
                assert(object.timeLeft > 0, 'The time left is less than 0');

                return sessions['delete'](token);
            }).then(function () {
                return sessions.get(token);
            }).then(function (object) {
                assert(object === null, 'Returns null');
            })['catch'](function (err) {
                throw err;
            });
        });

        // todo do actual tests on locking
        it('can run the same tests but with locking', function () {
            var sessions = new RedisSessions(client, {
                lock: true
            });
            return sessions.set(token, { dummy: true }).then(function (object) {
                assert(object, 'An object is not returned');
                assert(object.data, 'The object does not contain the data');
                assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                assert.equal(object.timeLeft, sessions.options.ttl, 'The time left is not equal to the ttl');

                return sessions.get(token);
            }).then(function (object) {
                assert(object, 'An object is not returned');
                assert(object.data, 'The object does not contain the data');
                assert(object.data.dummy, 'The dummy value is not set ' + JSON.stringify(object));
                assert(object.timeLeft <= sessions.options.ttl, 'The time left is more than the ttl');
                assert(object.timeLeft > 0, 'The time left is less than 0');

                return sessions['delete'](token);
            }).then(function () {
                return sessions.get(token);
            }).then(function (object) {
                assert(object === null, 'Returns null');
            })['catch'](function (err) {
                throw err;
            });
        });
    });

    describe('token generation', function () {
        it('can generate a token then check it', function () {
            var sessions = new RedisSessions(client);
            var generator = new TokenGenerator(sessions, {
                key: 'adwadwadawdawdawdawadwadaaaaaaaaaaaaaaaaaaaaaaaaaaawdwadwwaddawdadw',
                checkForCollision: false // we're not testing this right now
            });
            return generator.generateKey().then(function (key) {
                assert.notEqual(null, key, 'key is not returned');
                assert(key.token.length === 32, 'length of token is not 32');
                var parsed = generator.parseClientToken(key.clientToken);
                assert(parsed.token === key.token, 'key is not the same');
                assert(Date.now() - parsed.expiresAt <= sessions.options.ttl, 'the time left is more than the ttl');
                assert(generator.isValid(key.clientToken), 'the token is not valid');
            });
        });

        it('can check for collision', function () {
            var sessions = new RedisSessions(client);
            var generator = new TokenGenerator(sessions, {
                key: 'adwadwadawdawdawdawadwadaaaaaaaaaaaaaaaaaaaaaaaaaaawdwadwwaddawdadw'
            });
            return generator.generateKey();
        });
    });

    afterEach(function (done) {
        client.del(['resa:' + token, 'resa:' + token + ':lock'], done);
    });

    after(function () {
        client.quit();
    });
});

describe('redis sessions anywhere connect', () => {
    var client = redis.createClient();
    var sessions = new RedisSessions(client);
    var generator = new TokenGenerator(sessions, {
        key: 'adwadwadawdawdawdawadwadaaaaaaaaaaaaaaaaaaaaaaaaaaawdwadwwaddawdadw'
    });
    var app = express();
    app.use(cookieParser('some random secret')); // include cookie parser
    app.use(generator.connect()); // include our connect module

    app.get('/', function(request, response) {
        response.json(request.session);
    });
    app.get('/change', function(request, response) {
        request.session.dummy = true;
        response.json({});
    });
    var url = 'http://localhost:3000/';

    it('runs the basic set of tests', () => {
        return request({
            uri: url,
            jar: true,
            json: true
        }).then(res => {
            assert.deepEqual(res, {}, 'data was returned');
            return request({
                uri: url + 'change',
                jar: true,
                json: true
            });
        }).then(() => {
            return request({
                uri: url,
                jar: true,
                json: true
            });
        }).then((res) => {
            assert.deepEqual(res, {dummy: true}, 'dummy was not set');
        });
    });

    var server = app.listen(3000);
    after(function () {
        server.close();
        client.quit();
    });
});
