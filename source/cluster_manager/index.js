// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

var amqper = require('./amqpClient')();
var logger = require('./logger').logger;
var log = logger.getLogger('Main');
var ClusterManager = require('./clusterManager');
var toml = require('toml');
var fs = require('fs');
var Getopt = require('node-getopt');
// Parse command line arguments
var getopt = new Getopt([
  ['c' , 'config-file=ARG'             , 'Config toml file path of this agent'],
  ['h' , 'help'                       , 'display this help']
]);

var configFile = "./cluster_manager.toml";

var opt = getopt.parse(process.argv.slice(2));

for (var prop in opt.options) {
    if (opt.options.hasOwnProperty(prop)) {
        var value = opt.options[prop];
        switch (prop) {
            case 'help':
                getopt.showHelp();
                process.exit(0);
                break;
            case 'config-file':
                configFile = value;
                break;
        }
    }
}

var config;
try {
  config = toml.parse(fs.readFileSync(configFile));
} catch (e) {
  log.error('Parsing config error on line ' + e.line + ', column ' + e.column + ': ' + e.message);
  process.exit(1);
}

config.manager = config.manager || {};
config.manager.name = config.manager.name || 'owt-cluster';
config.manager.initial_time = config.manager.initial_time || 10 * 1000;
config.manager.check_alive_interval = config.manager.check_alive_interval || 1000;
config.manager.check_alive_count = config.manager.check_alive_count || 10;
config.manager.schedule_reserve_time = config.manager.schedule_reserve_time || 60 * 1000;

config.strategy = config.strategy || {};
config.strategy.general = config.strategy.general || 'round-robin';
config.strategy.portal = config.strategy.portal || 'last-used';
config.strategy.conference = config.strategy.conference || 'last-used';
config.strategy.webrtc = config.strategy.webrtc || 'last-used';
config.strategy.sip = config.strategy.sip || 'round-robin';
config.strategy.streaming = config.strategy.streaming || 'round-robin';
config.strategy.recording = config.strategy.recording || 'randomly-pick';
config.strategy.audio = config.strategy.audio || 'most-used';
config.strategy.video = config.strategy.video || 'least-used';
config.strategy.analytics = config.strategy.analytics || 'least-used';

config.rabbit = config.rabbit || {};
config.rabbit.host = config.rabbit.host || 'localhost';
config.rabbit.port = config.rabbit.port || 5672;

function startup () {
    var enableService = function () {
        var id = Math.floor(Math.random() * 1000000000);
        var spec = {initialTime: config.manager.initial_time,
                    checkAlivePeriod: config.manager.check_alive_interval,
                    checkAliveCount: config.manager.check_alive_count,
                    scheduleKeepTime: config.manager.schedule_reserve_time,
                    strategy: config.strategy
                   };

        amqper.asTopicParticipant(config.manager.name + '.management', function(channel) {
            log.info('Cluster manager up! id:', id);
            ClusterManager.run(channel, config.manager.name, id, spec);
        }, function(reason) {
            log.error('Cluster manager initializing failed, reason:', reason);
            process.kill(process.pid, 'SIGINT');
        });
    };

    amqper.connect(config.rabbit, function () {
        enableService();
    }, function(reason) {
        log.error('Cluster manager connect to rabbitMQ server failed, reason:', reason);
        process.kill(process.pid, 'SIGINT');
    });
}

startup();

['SIGINT', 'SIGTERM'].map(function (sig) {
    process.on(sig, async function () {
        log.warn('Exiting on', sig);
        try {
            await amqper.disconnect();
        } catch (e) {
            log.warn('Disconnect:', e);
        }
        process.exit();
    });
});

process.on('exit', function () {
    log.info('Process exit');
    // amqper.disconnect();
});

process.on('SIGUSR2', function() {
    logger.reconfigure();
});