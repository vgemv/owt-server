#!/usr/bin/env node
// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

const path = require('path');
const fs = require('fs');

const cipher = require('./cipher');
const authStore = path.resolve(__dirname, cipher.astore);
const authBase = path.basename(path.dirname(authStore));
const { Writable } = require('stream');

const mutableStdout = new Writable({
  write(chunk, encoding, callback) {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  },
});

const readline = require('readline').createInterface({
  input: process.stdin,
  output: mutableStdout,
  terminal: true,
});

readline.on('SIGINT', () => {
  readline.close();
});

const question = (input) => new Promise((resolve) => {
  readline.question(input, (answer) => {
    resolve(answer);
  });
});

const saveRegistry = async (ip) => {
  let configFile = fs.readdirSync(__dirname).filter(i=>i.toLowerCase().endsWith(".toml"))[0];
  fs.statSync(configFile);
  let data = fs.readFileSync(configFile, 'utf8');
  data = data.replace(/^([ ]*\[mongo\].*\n(^[ ]*#.*\n)*(^[ ]*[^\[]*\n)*)(^[ ]*dataBaseURL.*)/m, `$1dataBaseURL = "${ip}/owtdb"`);
  data = data.replace(/^([ ]*\[rabbit\].*\n(^[ ]*#.*\n)*(^[ ]*[^\[]*\n)*)(^[ ]*host.*)/m, `$1host = "${ip}"`);
  let ret = fs.writeFileSync(configFile, data, 'utf8');
  return ret;
};

const saveAuth = (obj, filename) => new Promise((resolve, reject) => {
  const lock = (obj) => {
    cipher.lock(cipher.k, obj, filename, (err) => {
      if (!err) {
        process.stdout.write(err || 'done!\n');
        resolve();
      } else {
        reject(err);
      }
    });
  };
  if (fs.existsSync(filename)) {
    cipher.unlock(cipher.k, filename, (err, res) => {
      if (!err) {
        res = Object.assign(res, obj);
        lock(res);
      } else {
        reject(err);
      }
    });
  } else {
    lock(obj);
  }
});

const updateRabbit = () => new Promise((resolve, reject) => {
  question('Update RabbitMQ account?[yes/no]')
    .then((answer) => {
      answer = answer.toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        resolve();
        return;
      }
      question(`(${authBase}) Enter username of rabbitmq: `)
        .then((username) => {
          question(`(${authBase}) Enter password of rabbitmq: `)
            .then((password) => {
              mutableStdout.muted = false;
              saveAuth({ rabbit: { username, password } }, authStore)
                .then(resolve)
                .catch(reject);
            });
          mutableStdout.muted = true;
        });
    });
});

const updateMongo = () => new Promise((resolve, reject) => {
  question('Update MongoDB account?[yes/no]')
    .then((answer) => {
      answer = answer.toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        resolve();
        return;
      }
      question(`(${authBase}) Enter username of mongodb: `)
        .then((username) => {
          question(`(${authBase}) Enter password of mongodb: `)
            .then((password) => {
              mutableStdout.muted = false;
              saveAuth({ mongo: { username, password } }, authStore)
                .then(resolve)
                .catch(reject);
            });
          mutableStdout.muted = true;
        });
    });
});

const updateInternal = () => new Promise((resolve, reject) => {
  question('Update internal passphrase?[yes/no]')
    .then((answer) => {
      answer = answer.toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        resolve();
        return;
      }
      question(`(${authBase}) Enter internal passphrase: `)
        .then((passphrase) => {
          mutableStdout.muted = false;
          saveAuth({ internalPass: passphrase }, authStore)
            .then(resolve)
            .catch(reject);
        });
      mutableStdout.muted = true;
    });
});

const options = {};
const parseArgs = () => {
  if (process.argv.includes('--rabbitmq')) {
    options.rabbit = true;
  }
  if (process.argv.includes('--mongodb')) {
    options.mongo = true;
  }
  if (process.argv.includes('--internal')) {
    options.internal = true;
  }
  if (process.argv.includes('--all')) {
    options.all = true;
    options.user = process.argv[3];
    options.password = process.argv[4];
    options.ip = process.argv[5];
  }
  if (process.argv.includes('--registry')) {
    options.registry = true;
    options.ip = process.argv[3];
  }
  if (Object.keys(options).length === 0) {
    options.rabbit = true;
    options.mongo = true;
  }
  return Promise.resolve();
}

parseArgs()
  .then(async () => {
    if (options.all) {
      await saveAuth({ internalPass: options.password }, authStore);
      await saveAuth({ mongo: { username: options.user, password: options.password } }, authStore)
      await saveAuth({ rabbit: { username: options.user, password: options.password } }, authStore)
    }
  })
  .then(async () => {
    if (options.registry && options.ip) {
      saveRegistry(options.ip)
    }
  })
  .then(() => {
    if (options.rabbit) {
      return updateRabbit();
    }
  })
  .then(() => {
    if (options.mongo) {
      return updateMongo();
    }
  })
  .then(() => {
    if (options.internal) {
      return updateInternal();
    }
  })
  .finally(() => readline.close());
