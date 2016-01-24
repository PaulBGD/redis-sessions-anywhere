# redis-sessions-anywhere
A module for using session outside of connect/express

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

## Retrieving the raw .js file or the .d.ts file

To keep commit history clean, our built .js and .d.ts files are not included on git. To get them, just clone the repository then run

```
npm run build
```
