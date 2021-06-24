// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

var logger = require('./logger').logger;

// Logger
var log = logger.getLogger('LoadCollector');

var child_process = require('child_process');
var os = require('os');
var process = require('process');

var usageCollector = function (period, items, onLoad) {
    let stats = {};
    let cpu = items.indexOf("cpu")>=0 && new selfCpuCollector(period, (usage)=>{
        stats.cpu = usage;
    });
    let mem = items.indexOf("mem")>=0 && new selfMemCollector(period, (usage, bytes)=>{
        stats.mem = usage;
        stats.mem_bytes = bytes;
    });
    let net = items.indexOf("net")>=0 && new selfNetworkCollector(period, (usage)=>{
        stats.net = usage;
    });

    let interval = setInterval(()=>{
        onLoad(stats);
    }, period);

    this.stop = function () {
        log.debug("To stop usage collector.");
        cpu && cpu.stop();
        mem && mem.stop();
        net && net.stop();
        clearInterval(interval);
    };
};

var selfCpuCollector = function (period, onLoad) {
    var olds = os.cpus();
    var oldCurrent = Object.values(process.cpuUsage()).reduce((a,b)=>a+b,0);
    var begin = 0;
    var end = olds.length - 1;
    var interval = setInterval(function() {
        var cpus = os.cpus();
        var idle = 0;
        var total = 0;
        var current = Object.values(process.cpuUsage()).reduce((a,b)=>a+b,0);
        for (let i = begin; i <= end; i++) {
            for (let key in cpus[i].times) {
                let diff = cpus[i].times[key] - olds[i].times[key];
                if (key === 'idle') {
                    idle += diff;
                }
                total += diff;
            }
        }
        olds = cpus;
        onLoad((current-oldCurrent)/total);
        log.debug('self cpu usage:', (current-oldCurrent)/total);
        oldCurrent = current;
    }, period);

    this.stop = function () {
        log.debug("To stop cpu load collector.");
        clearInterval(interval);
    };
};

var selfMemCollector = function (period, onLoad) {
    var interval = setInterval(function() {
        let bytes = process.memoryUsage().rss;
        var usage = bytes / os.totalmem();
        onLoad(usage, bytes);
        log.debug('mem usage:', usage);
    }, period);

    this.stop = function () {
        log.debug("To mem cpu load collector.");
        clearInterval(interval);
    };
};

let hexToIpStr = function (hex) {
    return parseInt(`0x${hex[6]}${hex[7]}`) + "." +
        parseInt(`0x${hex[4]}${hex[5]}`) + "." +
        parseInt(`0x${hex[2]}${hex[3]}`) + "." +
        parseInt(`0x${hex[0]}${hex[1]}`);
};

let hexToPortStr = function (hex) {
    return parseInt(`0x${hex}`)
};

var selfNetworkCollector = function (period, onLoad) {

    // iftop -nNPt -f "port 30001"
    // netstat -tupa | grep "23411/node"
    // ls -l /proc/16291/fd/|grep socket|awk -F "->" '{print $2}'|awk -F "[\[\]]"  '{print $2}'
    // cat /proc/16845/net/udp /proc/16845/net/tcp|grep socket|awk -F "->" '{print $2}'|awk -F "[\[\]]"  '{print $2}'

    let iftopList = {};
    let networkStats = {};

    let interval = setInterval(()=>{
        // 找到进程使用socket句柄，根据句柄找到ip和port，最后使用 iftop 得到网络使用量
        let cmd = `cat /proc/${process.pid}/net/udp /proc/${process.pid}/net/tcp|awk '{print $2" "$10}'|grep -E $(ls -l /proc/${process.pid}/fd |grep socket|awk -F "->" '{print $2}'|awk -F "[\\[\\]]"  '{print $2}'|paste -sd "|")|awk '{print $1}'`
        child_process.exec(cmd, function(err, stdout, stderr) {
            /*
            [ '020012AC:7530' ]

            TO

            [{
                ip: "172.2.0.2",
                port: 30000
            }]

            */
            let ips = stdout.split("\n").map(i=>i.split(":")).map(i=>({
                ip: hexToIpStr(i[0]),
                port: hexToPortStr(i[1])
            })).filter(i=>i.port>0);

            // start iftop if not exist
            ips.forEach(i=>{
                let ipstr = i.ip + ":" + i.port;
                if(!iftopList[ipstr]){
                    let cmdPath = '/usr/sbin/iftop';
                    let param = ["-oL", cmdPath, '-nNPBt', '-f', `host ${i.ip} and port ${i.port}`];
                    let cmd = `iftop -nNPBt -f "host ${i.ip} and port ${i.port}"`;
                    networkStats[ipstr] = {
                        in_rate:0,
                        out_rate:0
                    }
                    // 使用 exec 实际 nodejs 会打开一个 shell 来执行指令，child_process.kill 只会杀掉 shell，iftop还在执行。
                    // 使用 execFile 不会打开 shell。
                    // 使用 stdbuf 可以使用 -oL 参数控制 iftop 的输出缓冲为 line。（pipe状态下缓冲不为line，会导致 stdout 延迟收到)
                    // iftopList[ipstr] = child_process.exec(cmd);
                    iftopList[ipstr] = child_process.execFile("/usr/bin/stdbuf", param, (err)=>{
                        delete iftopList[ipstr];
                        log.debug("iftop exit: ",err);
                    });
                    iftopList[ipstr].stdout.on("data",(stdout)=>{
                        let in_fmted = stdout.split("\n")
                            .filter(i=>i.indexOf("=>")>=0)
                            .map(i=>i.split(" ")// to array
                                .filter(i=>i.indexOf("B")>=0)// delete not rate item
                            )
                            .filter(i=>i.length>1)// check
                            .map(i=>i[1]);
                        let out_fmted = stdout.split("\n")
                            .filter(i=>i.indexOf("<=")>=0)
                            .map(i=>i.split(" ")// to array
                                .filter(i=>i.indexOf("B")>=0)// delete not rate item
                            )
                            .filter(i=>i.length>1)// check
                            .map(i=>i[1]);

                        if(in_fmted.length)
                            networkStats[ipstr].in_rate = in_fmted[0];
                        if(out_fmted.length)
                            networkStats[ipstr].out_rate = out_fmted[0];
                    });
                }
            });

            // stop iftop which no longer exist
            let ipstrList = ips.map(i=>i.ip+":"+i.port);
            let needRemove = Object.keys(iftopList).filter(i=>ipstrList.indexOf(i)<0);
            needRemove.forEach(i=>{
                let needRemoveIfTop = iftopList[i];
                needRemoveIfTop.kill();
                delete iftopList[i];
                delete networkStats[i];
            })

        });

        onLoad(networkStats);

    }, period);

    this.stop = function () {
        log.debug("To stop selfNetwork load collector.");
        Object.keys(iftopList).forEach(i=>{
            let item = iftopList[i];
            item.kill();
        })
        clearInterval(interval);
    };
};

var cpuCollector = function (period, onLoad) {
    var olds = os.cpus();
    var begin = 0;
    var end = olds.length - 1;
    var interval = setInterval(function() {
        var cpus = os.cpus();
        var idle = 0;
        var total = 0;
        for (let i = begin; i <= end; i++) {
            for (let key in cpus[i].times) {
                let diff = cpus[i].times[key] - olds[i].times[key];
                if (key === 'idle') {
                    idle += diff;
                }
                total += diff;
            }
        }
        olds = cpus;
        onLoad(1 - idle/total);
        log.debug('cpu usage:', 1 - idle/total);
    }, period);

    this.stop = function () {
        log.debug("To stop cpu load collector.");
        clearInterval(interval);
    };
};

var memCollector = function (period, onLoad) {
    var interval = setInterval(function() {
        var usage = 1 - os.freemem() / os.totalmem();
        onLoad(usage);
        log.debug('mem usage:', usage);
    }, period);

    this.stop = function () {
        log.debug("To mem cpu load collector.");
        clearInterval(interval);
    };
};

var diskCollector = function (period, drive, on_load) {
    var interval = setInterval(function () {
        var total = 1, free = 0;
        child_process.exec("df -k '" + drive.replace(/'/g,"'\\''") + "'", function(err, stdout, stderr) {
            if (err) {
                log.error(stderr);
            } else {
                var lines = stdout.trim().split('\n');

                var str_disk_info = lines[lines.length - 1].replace( /[\s\n\r]+/g,' ');
                var disk_info = str_disk_info.split(' ');

                total = disk_info[1];
                free = disk_info[3];
                on_load(Math.round((1.0 - free / total) * 1000) / 1000);
            }
        });
    }, period);

    this.stop = function () {
        log.debug("To stop disk load collector.");
        clearInterval(interval);
    };
};

var networkCollector = function (period, interf, max_scale, on_load) {
    var rx_Mbps = 0, tx_Mbps = 0, rx_bytes = 0, tx_bytes = 0;
    var meter = setInterval(function () {
        child_process.exec("awk 'NR>2{if (index($1, \"" + interf + "\")==1){print $2, $10}}' /proc/net/dev", function (err, stdout, stderr) {
            if (err) {
                log.error(stderr);
            } else {
                var fields = stdout.trim().split(" ");
                if (fields.length < 2) {
                    return log.warn('not ordinary network load data');
                }
                var rx = Number(fields[0]), tx = Number(fields[1]);
                if (rx >= rx_bytes && rx_bytes > 0) {
                    rx_Mbps = Math.round(((rx - rx_bytes) * 8 / 1048576) * 1000) / 1000;
                }

                if (tx >= tx_bytes && tx_bytes > 0) {
                    tx_Mbps = Math.round(((tx - tx_bytes) * 8 / 1048576) * 1000) / 1000;
                }

                rx_bytes = rx;
                tx_bytes = tx;
            }
        });
    }, 1000);

    var reporter = setInterval(function () {
        var rt_load = Math.round(Math.max(rx_Mbps / max_scale, tx_Mbps / max_scale) * 1000) / 1000;
        on_load(rt_load);
    }, period);

    this.stop = function () {
        log.debug("To stop network load collector.");
        meter && clearInterval(meter);
        reporter && clearInterval(reporter);
        meter = undefined;
        reporter = undefined;
    };
};

var gpuCollector = function (period, on_load) {
    var child = child_process.exec('stdbuf -o0 metrics_monitor 100 1000');
    var cpu_load = 0,
        cpu_collector = new cpuCollector(period, function (data) {cpu_load = data;});

    var load = 0;
    child.stdout.on('data', function (data) {
        var usage_sum = 0, samples = 0;
        var lines = data.toString().split('\n');

        var i = lines.length > 10 ? lines.length - 10 : 0;
        for (; i < lines.length; i++) {
            var engine_list = lines[i].split('\t');
            var engine_max_usage = 0;
            for (var engine of engine_list) {
                var m = null;
                if ((m = engine.match(/\s+usage:\s+(\d+\.\d+)/)) && m !== null && m.length > 1) {
                    var engine_usage = Number(m[1]);
                    if (engine_max_usage < engine_usage)
                        engine_max_usage = engine_usage;
                }
            }
            usage_sum = usage_sum + engine_max_usage;
            samples = samples + 1;
        }

        if (samples > 0)
            load = (usage_sum / samples) / 100;
        else
            load = 0;
    });

    var interval = setInterval(function () {
        var result = Math.max(load, cpu_load);
        on_load(result);
    }, period);

    this.stop = function () {
        log.debug("To stop gpu load collector.");
        cpu_collector && cpu_collector.stop();
        cpu_collector = undefined;
        child && child.kill();
        child = undefined;
        interval && clearInterval(interval);
        interval = undefined;
    };
};

exports.LoadCollector = function (spec) {
    var that = {};

    var period = spec.period || 1000,
        item = spec.item,
        on_load = spec.onLoad || function (load) {log.debug('Got', item.name, 'load:', load);},
        collector = undefined;

    that.stop = function () {
        log.info("To stop load collector.");
        collector && collector.stop();
        collector = undefined;
    };

    switch (item.name) {
        case 'network':
            collector = new networkCollector(period, item.interf, item.max_scale, on_load);
            break;
        case 'cpu':
            collector = new cpuCollector(period, on_load);
            break;
        case 'gpu':
            collector = new gpuCollector(period, on_load);
            break;
        case 'memory':
            collector = new memCollector(period, on_load);
            break;
        case 'disk':
            collector = new diskCollector(period, item.drive, on_load);
            break;
        default:
            log.error('Unknown load item');
            return undefined;
            //break;
    }

    return that;
};

exports.UsageCollector = function (spec) {
    var that = {};

    var period = spec.period || 1000,
        items = spec.items || [],
        on_load = spec.onLoad || function (load) {log.debug('Got', items, 'load:', load);},
        collector = undefined;

    that.stop = function () {
        log.info("To stop usage collector.");
        collector && collector.stop();
        collector = undefined;
    };

    collector = new usageCollector(period, items, on_load);

    return that;
}
