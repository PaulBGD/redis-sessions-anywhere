# redis-sessions-anywhere

[![Build Status](https://travis-ci.org/PaulBGD/redis-sessions-anywhere.svg?branch=master)](https://travis-ci.org/PaulBGD/redis-sessions-anywhere)

A module for using session outside of connect/express

## Installation

```
npm install --save redis-sessions-anywhere
```

## Usage

### TypeScript (preferred)

```javascript
import * as redis from 'redis';
import RedisSessionsAnywhere, {SessionObject} from 'redis-sessions-anywhere';

let client = redis.createClient();
let sessions = new RedisSessionsAnywhere<Session>(client);

// you can declare an interface to describe your session object, if you want
interface Session {
    someData?: string;
    otherData?: number;
}

// token is a uniquely generated token
sessions.get(token).then((session: SessionObject<Session>) => {
    // session looks like
    // {
    //    data: {
    //        // your session interface
    //    },
    //    timeLeft: 214122 // how much time until this session expires
    // }
    // or it returns null if there is no session data set
});

sessions.set(token, {
    someData: 'some data!',
    otherData: 42
}).then((session: SessionObject<Session>) => {
    // same object returned as in the get method
});

sessions.delete(token).then(() => {
    // session deleted
});
```

### JavaScript

```javascript
let redis = require('redis');
let RedisSessionsAnywhere = require('redis-sessions-anywhere');

let client = redis.createClient();
let sessions = new RedisSessionsAnywhere(client);

// token is a uniquely generated token
sessions.get(token).then(session => {
    // session looks like
    // {
    //    data: {
    //        // your session data
    //    },
    //    timeLeft: 214122 // how much time until this session expires
    // }
    // or it returns null if there is no session data set
});

sessions.set(token, {
    someData: 'some data!',
    otherData: 42
}).then(session => {
    // same object returned as in the get method
});

sessions.delete(token).then(() => {
    // session deleted
});
```

## Token Generation

We include a class to handle token generation in a secure way. Here's an example usage:

```javascript
import RedisSessionsAnywhere, {TokenGenerator} from 'redis-sessions-anywhere';

// or in es5
// var RedisSessionsAnywhere = require('redis-sessions-anywhere');
// var TokenGenerator = RedisSessionsAnywhere.TokenGenerator;

let sessions = new RedisSessionsAnywhere(client);
let generator = new TokenGenerator(sessions, {
    key: 'aaaaaaaaaaaaaaaa' // this should be a secure key, generated and stored in a config
});

generator.generateKey().then(key => {
    // key looks like
    // {token: 'awddaawdawdadd', clientToken: 'awdawdawd.adwadawdada.awdawdadw'}
    // the 'token' is what you'll pass when handling sessions
    // the clientToken is what you'll store on your client
});

// you can later verify the clientToken by doing
generator.isValid(clientToken); // => true/false

// when you need to get the original token from the clientToken, just do
generator.parseClientToken(clientToken); // => {token: 'awdawdwadadad', expiresAt: 123213123}
```

## Using as connect middleware

After creating your sessions and generator objects, you can call `.connect` on the generator to return a connect middleware.

```javascript
app.use(cookieParser('super secret')); // include cookie parser
app.use(generator.connect()); // include our connect module
```

You can also pass options to the connect middleware

* cookieName - the name of the cookie in the browser
* alwaysUpdate - always updates the session object in redis, which also updates the time it times out

## Options

### RedisSessionsAnywhere

* prefix - the prefix for sessions in redis
* ttl - how long sessions last

* lock (default false) - enables locking, which sets a lock before setting data. This fixes an issue when two instances are setting the same key
* lockSuffix (only used if lock is true) - the suffix to use for the lock keys
* lockTtl (only used if lock is true) - how long a lock key will exist
* lockRetry (only used if lock is true) - how long in ms between checking the lock status

### TokenGenerator

* key (required) - a strong key which encrypts the tokens. This should be randomly generated at the first run. There are no length restrictions
* tokenBytes - how many bytes a token consists of
* checkForCollision (default true) - if you like to gamble a bit, then set this to false and hope your tokens never collide

## Retrieving the raw .js file, the .d.ts file, or the source map

To keep commit history clean, our built .js and .d.ts files are not included on git. To get them, just clone the repository then run

```
npm run build
```
