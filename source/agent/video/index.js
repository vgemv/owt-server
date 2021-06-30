// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
const BlackPNG1px = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2NgYGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg==";
var MediaFrameMulticaster = require('../mediaFrameMulticaster/build/Release/mediaFrameMulticaster');

var logger = require('../logger').logger;

// Logger
var log = logger.getLogger('VideoNode');
var InternalConnectionFactory = require('./InternalConnectionFactory');
var internalConnFactory = new InternalConnectionFactory;
var mediaUtil = require('../mediaUtil');
var calcDefaultBitrate = mediaUtil.calcDefaultBitrate;
var resolution2String = mediaUtil.resolution2String;
var isResolutionEqual = mediaUtil.isResolutionEqual;

const { LayoutProcessor } = require('./layout');

var useHardware = global.config.video.hardwareAccelerated,
    gaccPluginEnabled = global.config.video.enableBetterHEVCQuality || false,
    MFE_timeout = global.config.video.MFE_timeout || 0,
    supported_codecs = global.config.video.codecs;

var VideoMixer, VideoTranscoder;
try {
    if (useHardware) {
        VideoMixer = require('../videoMixer_msdk/build/Release/videoMixer-msdk');
        VideoTranscoder = require('../videoTranscoder_msdk/build/Release/videoTranscoder-msdk');
    } else {
        VideoMixer = require('../videoMixer_sw/build/Release/videoMixer-sw');
        VideoTranscoder = require('../videoTranscoder_sw/build/Release/videoTranscoder-sw');
    }
} catch (e) {
    log.error(e);
    process.exit(-2);
}

const colorMap = {
  'white': { r: 255, g: 255, b: 255 },
  'black': { r: 0, g: 0, b: 0 }
};

class InputManager {

    constructor(maxInput, staticInput) {
        // Key: stream ID, Value: input-object
        this.inputs = {};
        this.pendingInputs = {};
        this.freeIndex = [];
        this.staticInput = staticInput || 0;

        // Default to 100 if not specified
        if (typeof maxInput !== 'number' || maxInput <= 0) maxInput = 100;
        for (let i = 0; i < maxInput; i++) {
            this.freeIndex.push(i);
        }
        this.freeIndex.reverse();
    }

    reset(maxInput) {
      constructor(maxInput);
    }

    setStaticInput(num, removeInputIds) {
        removeInputIds = removeInputIds || [];
        let keepStaticSid = Object.keys(this.inputs).filter(i=>{
            let inputId = this.inputs[i].id;
            return inputId < this.staticInput && removeInputIds.indexOf(inputId) < 0;
        }).sort((a,b)=>{
            return this.inputs[a].id - this.inputs[b].id;
        });

        // remove useless static input
        Object.keys(this.inputs).filter(i=>{
            let inputId = this.inputs[i].id;
            return removeInputIds.indexOf(inputId) >= 0;
        }).forEach(i=>{
            this.remove(i);
        })

        // reorder the static input id
        keepStaticSid.forEach((i,idx)=>{
            let input = this.get(i);
            this.remove(i);
            this.set(i, idx, input.codec, input.conn, input.avatar);
        })

        this.staticInput = num;
    }

    // Has the streamId
    has(streamId) {
        return (!!this.inputs[streamId] || !!this.pendingInputs[streamId]);
    }

    isPending(streamId) {
        return !!this.pendingInputs[streamId];
    }

    get(streamId) {
        return (this.inputs[streamId] || this.pendingInputs[streamId]);
    }

    set(streamId, inputId, codec, conn, avatar) {
        if (this.inputs[streamId])
            return -1;

        let inputIdIdx = this.freeIndex.findIndex(o=>o==inputId);
        if(inputIdIdx == -1)
            return -1;

        this.freeIndex.splice(inputIdIdx,1);

        var input = {
            id: inputId,
            codec: codec,
            conn: conn,
            avatar: avatar,
            primaryCount: 0
        };
        if (input.id === undefined) {
            this.pendingInputs[streamId] = input;
            return -1;
        } else {
            this.inputs[streamId] = input;
            return input.id;
        }
    }

    add(streamId, codec, conn, avatar) {
        if (this.inputs[streamId])
            return -1;
        let inputIdIdx = this.freeIndex.findIndex(o=>o>=this.staticInput);
        let inputId;
        if(inputIdIdx >= 0){
            inputId = this.freeIndex[inputIdIdx];
            this.freeIndex.splice(inputIdIdx,1);
        }

        var input = {
            id: inputId,
            codec: codec,
            conn: conn,
            avatar: avatar,
            primaryCount: 0
        };
        if (input.id === undefined) {
            this.pendingInputs[streamId] = input;
            return -1;
        } else {
            this.inputs[streamId] = input;
            return input.id;
        }
    }

    remove(streamId) {
        var input = null;
        if (this.inputs[streamId]) {
            input = this.inputs[streamId];
            delete this.inputs[streamId];
            this.freeIndex.push(input.id);
        } else if (this.pendingInputs[streamId]) {
            input = this.pendingInputs[streamId];
            delete this.pendingInputs[streamId];
        }
        return input;
    }

    enable(streamId, toPending) {
        if (!this.pendingInputs[streamId] || streamId === toPending)
            return -1;

        // Move least setPrimary input to pending
        var k;
        var minPrimary = Number.MAX_SAFE_INTEGER;

        if (toPending === undefined) {
            for (let k in this.inputs) {
                if (this.inputs[k].primaryCount < minPrimary || !toPending) {
                    minPrimary = this.inputs[k].primaryCount;
                    toPending = k;
                }
            }
        }

        if (toPending !== undefined) {
            this.pendingInputs[toPending] = this.inputs[toPending];
            delete this.inputs[toPending];
            this.inputs[streamId] = this.pendingInputs[streamId];
            delete this.pendingInputs[streamId];
            // Swap their input id
            this.inputs[streamId].id = this.pendingInputs[toPending].id;
            this.pendingInputs[toPending].id = undefined;
            // Return the changed input id
            return this.inputs[streamId].id;
        }

        return -1;
    }

    promotePendingStream(inputId) {
        var pos = this.freeIndex.indexOf(inputId)
        if (pos < 0)
            return;

        var streamId;
        for (streamId in this.pendingInputs) {
            break;
        }
        if (streamId) {
            this.inputs[streamId] = this.pendingInputs[streamId];
            this.inputs[streamId].id = inputId;
            delete this.pendingInputs[streamId];
            this.freeIndex.splice(pos, 1);
            return this.inputs[streamId];
        }
        return null;
    }

    size() {
        return Object.keys(this.inputs).length;
    }

    getStreamList() {
        return Object.keys(this.inputs).concat(Object.keys(this.pendingInputs));
    }

    getStaticInputs() {
        return Object.keys(this.inputs).filter(i=>{
            return this.inputs[i].id < this.staticInput;
        }).map(i=>{
            return this.inputs[i]
        })
    }

    // Get stream from input
    getStreamFromInput(inputId) {
        for (let streamId in this.inputs) {
            if (this.inputs[streamId].id === inputId) {
                return streamId;
            }
        }
        return null;
    }
}

function VMixer(rpcClient, clusterIP) {
    var that = {},
        engine,
        layoutProcessor,
        belong_to,
        controller,
        view,

        drawing_text_tmr,

        motion_factor = 0.8,
        default_resolution = {width: 640, height: 480},
        default_framerate = 30,
        default_kfi = 1000,

        /*{StreamID : {codec: 'vp8' | 'h264' |...,
                       resolution: {width: Number(Width), height: Number(Height)},
                       framerate: Number(FPS),
                       bitrate: Number(Kbps),
                       kfi: Number(KeyFrameIntervalSeconds),
                       dispatcher: Dispather,
                       }}*/
        outputs = {},

        /*{StreamID : InternalIn}*/
        inputManager,
        maxInputNum = 0,
        staticParticipants = [],

        /*{ConnectionID: {video: StreamID | undefined,
                          connection: InternalOut}
                         }
         }
         */
        connections = {};

    var addInput = function (stream_id, codec, options, avatar, on_ok, on_error) {
        log.info('add input', stream_id);
        // FIXME: filter profile setting for native layer
        codec = codec.indexOf('h264') > -1 ? 'h264' : codec;
        if (engine) {
            var conn = internalConnFactory.fetch(stream_id, 'in');
            if (!conn) {
                on_error('Create internal connection failed.');
                return;
            }
            conn.connect(options);

            // Use default avatar if it is not set
            avatar = avatar || global.config.avatar.location;

            let inputId = options.inputId >= 0? 
                inputManager.set(stream_id, options.inputId, codec, conn, avatar): 
                inputManager.add(stream_id, codec, conn, avatar);

            if (inputId >= 0) {
                if (engine.addInput(inputId, codec, conn, avatar)) {
                    layoutProcessor.addInput(inputId);
                    log.debug('addInput ok, stream_id:', stream_id, 'codec:', codec, 'options:', options);
                    on_ok(stream_id);
                } else {
                    internalConnFactory.destroy(stream_id, 'in');
                    on_error('Failed in adding input to video-engine.');
                }
            } else {
                log.debug('addInput pending', stream_id);
                on_ok(stream_id);
            }
        } else {
            on_error('Video-mixer engine is not ready.');
        }
    };

    var removeInput = function (stream_id) {
        log.info('remove input', stream_id);
        if (inputManager.has(stream_id)) {
            let input = inputManager.remove(stream_id);
            if (input.id >= 0) {
                // Remove activate input
                engine.removeInput(input.id);
                let newInput = inputManager.promotePendingStream(input.id);
                if (newInput) {
                    // If there's pending input
                    let newStreamId = inputManager.getStreamFromInput(newInput.id);
                    if (!engine.addInput(newInput.id, newInput.codec, newInput.conn, newInput.avatar)) {
                        layoutProcessor.removeInput(newInput.id);
                        log.error('engine fail to add pending input', newStreamId);
                    }
                    log.debug('add pending input', newStreamId);
                } else {
                    layoutProcessor.removeInput(input.id);
                }
            }
            internalConnFactory.destroy(stream_id, 'in');
        } else {
            log.error('no such input to remove:', stream_id);
        }
    };

    var addOutput = function (codec, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error) {
        log.info('addOutput: codec', codec, 'resolution:', resolution, 'framerate:', framerate, 'bitrate:', bitrate, 'keyFrameInterval:', keyFrameInterval);
        if (engine) {
            var stream_id = Math.random() * 1000000000000000000 + '';
            var dispatcher = new MediaFrameMulticaster();
            if (engine.addOutput(stream_id,
                                 codec,
                                 resolution2String(resolution),
                                 framerate,
                                 bitrate,
                                 keyFrameInterval,
                                 dispatcher)) {
                outputs[stream_id] = {codec: codec,
                                      resolution: resolution,
                                      framerate: framerate,
                                      bitrate: bitrate,
                                      kfi: keyFrameInterval,
                                      dispatcher: dispatcher,
                                      connections: {}};
                log.debug('addOutput ok, stream_id:', stream_id);
                on_ok(stream_id);
            } else {
                on_error('Failed in adding output to video-engine');
            }
        } else {
            on_error('Video-mixer engine is not ready.');
        }
    };

    var removeOutput = function (stream_id) {
        if (outputs[stream_id]) {
            var output = outputs[stream_id];
            for (var connectionId in output.connections) {
                 output.dispatcher.removeDestination('video', output.connections[connectionId].receiver());
                 output.connections[connectionId].close();
                 delete output.connections[connectionId];
            }
            engine.removeOutput(stream_id);
            output.dispatcher.close();
            delete outputs[stream_id];
        }
    };

    var getOutput = function (stream_id) {
        if (outputs[stream_id]) {
            return {
                id: stream_id,
                resolution: outputs[stream_id].resolution,
                framerate: outputs[stream_id].framerate,
                bitrate: outputs[stream_id].bitrate,
                keyFrameInterval: outputs[stream_id].kfi
            };
        } else {
            return undefined;
        }
    };

    var formatLayoutSolution = function (layoutSolution) {
        return layoutSolution.map((inputRegion) => {
            var rationalString = (obj) => (obj.numerator + '/' + obj.denominator);
            var curRegion = inputRegion.region;
            return {
                stream: inputManager.getStreamFromInput(inputRegion.input),
                region: {
                    id: curRegion.id,
                    shape: curRegion.shape,
                    area: curRegion.shape === 'rectangle' ?
                        {
                            left: rationalString(curRegion.area.left),
                            top: rationalString(curRegion.area.top),
                            width: rationalString(curRegion.area.width),
                            height: rationalString(curRegion.area.height),
                        } :
                        {
                            centerW: rationalString(curRegion.area.centerW),
                            centerH: rationalString(curRegion.area.centerH),
                            radius: rationalString(curRegion.area.radius),
                        }
                }
            };
        });
    };

    that.initialize = function (videoConfig, belongTo, layoutcontroller, mixView, callback) {
        log.info('initEngine, belongTo:', belongTo, 'view:', mixView);
        log.debug('initEngine, videoConfig:', JSON.stringify(videoConfig));
        if(videoConfig.staticParticipants)
            staticParticipants = videoConfig.staticParticipants.map(i => {
                if(i.avatarData)
                    i.avatarData = new Buffer(i.avatarData.data || i.avatarData, "base64");
                else
                    i.avatarData = new Buffer(BlackPNG1px, "base64");
                if(i.overlays){
                    i.overlays.forEach(i => {
                        if(i.imageData){
                            i.imageData = new Buffer(i.imageData.data || i.imageData, "base64");
                        }
                    })
                }
                return i;
            });
        var config = {
            'hardware': useHardware,
            'maxinput': videoConfig.maxInput || 16,
            'resolution': resolution2String(videoConfig.parameters.resolution),
            'backgroundcolor': (typeof videoConfig.bgColor === 'string') ? colorMap[videoConfig.bgColor] : videoConfig.bgColor,
            'backgroundimage': videoConfig.bgImage,
            'layout': videoConfig.layout.templates,
            'crop': (videoConfig.layout.fitPolicy === 'crop' ? true : false),
            'gaccplugin': gaccPluginEnabled,
            'MFE_timeout': MFE_timeout,
            'avatars': videoConfig.staticParticipants? videoConfig.staticParticipants.map(o => o.avatarData): []
        };


        inputManager = new InputManager(videoConfig.maxInput, staticParticipants.length);
        engine = new VideoMixer(config);
        layoutProcessor = new LayoutProcessor(videoConfig.layout.templates);
        layoutProcessor.on('error', function (e) {
            log.warn('layout error:', e);
        });
        layoutProcessor.on('layoutChange', function (layoutSolution) {
            log.info('layoutChange', layoutSolution);
            if (typeof engine.updateLayoutSolution === 'function') {
               engine.updateLayoutSolution(layoutSolution.filter((obj) => {return obj.input !== undefined;}));
            } else {
                log.warn('No native method: updateLayoutSolution');
            }

            var streamRegions = formatLayoutSolution(layoutSolution);
            var layoutChangeArgs = [belong_to, streamRegions, view];
            rpcClient.remoteCall(controller, 'onVideoLayoutChange', layoutChangeArgs);
        });
        layoutProcessor.on('sceneChange', function (sceneSolution) {
            log.info('sceneChange', sceneSolution);
            if (typeof engine.updateSceneSolution === 'function') {
                
                if(sceneSolution.bgImageData && typeof(sceneSolution.bgImageData) == "string"){
                    sceneSolution.bgImageData = new Buffer(sceneSolution.bgImageData, "base64");
                }
                if(sceneSolution.bgImageData && sceneSolution.bgImageData.data && typeof(sceneSolution.bgImageData.data) == "string"){
                    sceneSolution.bgImageData = new Buffer(sceneSolution.bgImageData.data, "base64");
                }

                if(sceneSolution.overlays){
                    sceneSolution.overlays.forEach(o => {
                        if(o.imageData && typeof(o.imageData) == "string")
                            o.imageData = new Buffer(o.imageData, "base64");
                        if(o.imageData && o.imageData.data && typeof(o.imageData.data) == "string")
                            o.imageData = new Buffer(o.imageData.data, "base64");
                    })
                }
                engine.updateSceneSolution(sceneSolution);
            
            } else {
                log.warn('No native method: updateSceneSolution');
            }

            if(sceneSolution.layout){
                var streamRegions = formatLayoutSolution(sceneSolution.layout);
                var layoutChangeArgs = [belong_to, streamRegions, view];
                rpcClient.remoteCall(controller, 'onVideoLayoutChange', layoutChangeArgs);
            }
        });
        belong_to = belongTo;
        controller = layoutcontroller;
        maxInputNum = videoConfig.maxInput;
        view = mixView;

        // FIXME: The supported codec list should be a sub-list of those querried from the engine
        // and filterred out according to config.
        motion_factor = (videoConfig.motionFactor || 0.8);
        default_resolution = (videoConfig.parameters.resolution || {width: 640, height: 480});
        default_framerate = (videoConfig.parameters.framerate || 30);
        default_kfi = (videoConfig.parameters.keyFrameInterval || 1000);

        layoutProcessor.setStaticInputNum(videoConfig.staticParticipants.length);
        staticParticipants.forEach((i,idx) => {
            engine.updateInputOverlay(idx, i.overlays);
        })

        log.info('Video engine init OK, supported_codecs:', supported_codecs);
        callback('callback', {codecs: supported_codecs});
    };

    that.deinit = function () {
        if (drawing_text_tmr) {
          clearTimeout(drawing_text_tmr);
          drawing_text_tmr = undefined;
        }

        for (var stream_id in outputs) {
            removeOutput(stream_id);
        }

        // Remove pending stream first
        for (let stream_id of inputManager.getStreamList()) {
            if (inputManager.isPending(stream_id)) {
                removeInput(stream_id);
            }
        }
        for (let stream_id of inputManager.getStreamList()) {
            removeInput(stream_id);
        }

        if (engine) {
            engine.close();
            engine = undefined;
        }
    };

    that.close = function() {
        if (engine) {
            that.deinit();
        }
    };

    that.onFaultDetected = function (message) {
        if (message.purpose === 'conference' && controller) {
            if ((message.type === 'node' && message.id === controller) ||
                (message.type === 'worker' && controller.startsWith(message.id))) {
                log.error('Conference controller (type:', message.type, 'id:', message.id, ') fault is detected, exit.');
                that.deinit();
                process.exit();
            }
        }
    };

    that.createInternalConnection = function (connectionId, direction, internalOpt, callback) {
        internalOpt.minport = global.config.internal.minport;
        internalOpt.maxport = global.config.internal.maxport;
        var portInfo = internalConnFactory.create(connectionId, direction, internalOpt);
        callback('callback', {ip: global.config.internal.ip_address, port: portInfo});
    };

    that.destroyInternalConnection = function (connectionId, direction, callback) {
        internalConnFactory.destroy(connectionId, direction);
        callback('callback', 'ok');
    };

    that.generate = function (codec, resolution, framerate, bitrate, keyFrameInterval, callback) {
        log.info('generate, codec:', codec, 'resolution:', resolution, 'framerate:', framerate, 'bitrate:', bitrate, 'keyFrameInterval:', keyFrameInterval);
        codec = (codec || supported_codecs.encode[0]).toLowerCase();
        resolution = (resolution === 'unspecified' ? default_resolution : resolution);
        framerate = (framerate === 'unspecified' ? default_framerate : framerate);
        var bitrate_factor = (typeof bitrate === 'string' ? (bitrate === 'unspecified' ? 1.0 : (Number(bitrate.replace('x', '')) || 0)) : 0);
        bitrate = (bitrate_factor ? calcDefaultBitrate(codec, resolution, framerate, motion_factor) * bitrate_factor : bitrate);
        keyFrameInterval = (keyFrameInterval === 'unspecified' ? default_kfi : keyFrameInterval);

        for (var stream_id in outputs) {
            if (outputs[stream_id].codec === codec &&
                isResolutionEqual(outputs[stream_id].resolution, resolution) &&
                outputs[stream_id].framerate === framerate &&
                outputs[stream_id].bitrate === bitrate &&
                outputs[stream_id].kfi === keyFrameInterval) {
                callback('callback', getOutput(stream_id));
                return;
            }
        }

        if (supported_codecs.encode.findIndex((c) => (c.toLowerCase() === codec)) < 0) {
            log.error('Not supported codec: '+codec);
            callback('callback', 'error', 'Not supported codec.');
            return;
        }

        addOutput(codec, resolution, framerate, bitrate, keyFrameInterval, function (stream_id) {
            callback('callback', getOutput(stream_id));
        }, function (error_reason) {
            log.error(error_reason);
            callback('callback', 'error', error_reason);
        });
    };

    that.degenerate = function (stream_id) {
        log.info('degenerate, stream_id:', stream_id);
        removeOutput(stream_id);
    };

    that.setInputActive = function (stream_id, active, callback) {
        log.debug('setInputActive, stream_id:', stream_id, 'active:', active);
        if (inputManager.has(stream_id) && !inputManager.isPending(stream_id)) {
            let inputId = inputManager.get(stream_id).id;
            engine.setInputActive(inputId, !!active);
            callback('callback', 'ok');
        } else {
            callback('callback', 'error', 'No stream:' + stream_id);
        }
    };

    that.setAvatar = function (inputId, avatar, callback) {
        log.debug('setInputActive, stream_id:', stream_id, 'active:', active);
        engine.setAvatar(inputId, avatar);
        callback('callback', 'ok');
    };

    that.publish = function (stream_id, stream_type, options, callback) {
        log.info('publish, stream_id:', stream_id, 'stream_type:', stream_type, 'options:', options);
        if (stream_type !== 'internal') {
            return callback('callback', 'error', 'can not publish a stream to video engine through a non-internal connection');
        }

        if (options.video === undefined || options.video.codec === undefined) {
            return callback('callback', 'error', 'can not publish a stream to video engine without proper video codec');
        }

        if (!inputManager.has(stream_id)) {
            log.debug('publish 1, inputs.length:', inputManager.size(), 'maxInputNum:', maxInputNum);
            addInput(stream_id, options.video.codec, options, options.avatar, function () {
                callback('callback', {ip: clusterIP, port: inputManager.get(stream_id).conn.getListeningPort()});
            }, function (error_reason) {
                log.error(error_reason);
                callback('callback', 'error', error_reason);
            });
        } else {
            callback('callback', {ip: clusterIP, port: inputManager.get(stream_id).conn.getListeningPort()});
        }
    };

    that.unpublish = function (stream_id) {
        log.info('unpublish, stream_id:', stream_id);
        removeInput(stream_id);
    };

    that.subscribe = function (connectionId, connectionType, options, callback) {
        log.info('subscribe, connectionId:', connectionId, 'connectionType:', connectionType, 'options:', options);
        if (connectionType !== 'internal') {
            return callback('callback', 'error', 'can not subscribe a stream from video engine through a non-internal connection');
        }

        var conn = internalConnFactory.fetch(connectionId, 'out');
        if (!conn) {
            callback('callback', 'error', 'Create internal connection failed.');
            return;
        }
        conn.connect(options);

        if (connections[connectionId] === undefined) {
            connections[connectionId] = {videoFrom: undefined,
                                         connection: conn
                                        };
        }
        callback('callback', 'ok');
    };

    that.unsubscribe = function (connectionId) {
        log.info('unsubscribe, connectionId:', connectionId);
        if (connections[connectionId] && connections[connectionId].videoFrom) {
            if (outputs[connections[connectionId].videoFrom]) {
                outputs[connections[connectionId].videoFrom].dispatcher.removeDestination('video', connections[connectionId].connection.receiver());
            }
            internalConnFactory.destroy(connectionId, 'out');
            delete connections[connectionId];
        }
    };

    that.linkup = function (connectionId, audio_stream_id, video_stream_id, data_stream_id, callback) {
        log.debug('linkup, connectionId:', connectionId, 'video_stream_id:', video_stream_id);
        if (connections[connectionId] === undefined) {
            return callback('callback', 'error', 'connection does not exist');
        }

        if (outputs[video_stream_id]) {
            outputs[video_stream_id].dispatcher.addDestination('video', connections[connectionId].connection.receiver());
            connections[connectionId].videoFrom = video_stream_id;
            callback('callback', 'ok');
        } else {
            log.error('Stream does not exist!', video_stream_id);
            callback('callback', 'error', 'Stream does not exist!');
        }
    };

    that.cutoff = function (connectionId) {
        log.debug('cutoff, connectionId:', connectionId);
        if (connections[connectionId] && connections[connectionId].videoFrom) {
            if (outputs[connections[connectionId].videoFrom]) {
                outputs[connections[connectionId].videoFrom].dispatcher.removeDestination('video', connections[connectionId].connection.receiver());
            }
            connections[connectionId].videoFrom = undefined;
        }
    };

    that.setPrimary = function (stream_id, callback) {
        log.debug('setPrimary, stream_id:', stream_id);
        if (inputManager.has(stream_id)) {
            let input;
            if (inputManager.isPending(stream_id)) {
                inputManager.enable(stream_id);
                input = inputManager.get(stream_id);
                engine.removeInput(input.id);
                if (!engine.addInput(input.id, input.codec, input.conn, input.avatar)) {
                    layoutProcessor.removeInput(input.id);
                    callback('callback', 'error', 'Switch input failed.');
                    return;
                }
            } else {
                input = inputManager.get(stream_id);
            }
            //TODO: re-implement the setPrimary method
            layoutProcessor.setPrimary(input.id);
            input.primaryCount++;
            callback('callback', 'ok');
        } else {
            callback('callback', 'error', 'Invalid input stream_id.');
        }
    };

    that.setRegion = function (stream_id, region_id, callback) {
        log.debug('setRegion, stream_id:', stream_id, 'region_id:', region_id);
        if (inputManager.has(stream_id)) {
            if (inputManager.isPending(stream_id)) {
                let originInput = layoutProcessor.getInput(region_id);
                if (originInput < 0) {
                    callback('callback', 'error', 'Invalid region');
                    return;
                }
                inputManager.enable(stream_id, inputManager.getStreamFromInput(originInput));
                let input = inputManager.get(stream_id);
                engine.removeInput(input.id);
                if (!engine.addInput(input.id, input.codec, input.conn, input.avatar)) {
                    layoutProcessor.removeInput(input.id);
                    callback('callback', 'error', 'Switch input failed.');
                } else {
                    callback('callback', 'ok');
                }
            } else {
                let inputId = inputManager.get(stream_id).id;
                if (layoutProcessor.specifyInputRegion(inputId, region_id)) {
                    callback('callback', 'ok');
                } else {
                    callback('callback', 'error', 'Invalid region_id.');
                }
            }
        } else {
            callback('callback', 'error', 'Invalid input stream_id.');
        }
    };

    that.getRegion = function (stream_id, callback) {
        log.debug('getRegion, stream_id:', stream_id);
        if (inputManager.has(stream_id) && !inputManager.isPending(stream_id)) {
            let inputId = inputManager.get(stream_id).id;
            let region = layoutProcessor.getRegion(inputId);
            let regionId = region ? region.id : '';
            callback('callback', regionId);
        } else {
            callback('callback', 'error', 'Invalid input stream_id.');
        }
    };

    that.setInputOverlay = function (inputId, overlays, callback) {
        log.info(`setInputOverlay, inputId: ${inputId}, overlays: `, JSON.stringify(overlays));
        if(overlays){
            overlays.forEach(o=>{
                if(o.imageData && o.imageData.data)
                    o.imageData = new Buffer(o.imageData.data, "base64");
            })
        }

        engine.updateInputOverlay(inputId, overlays);
        callback('callback', true);
    }

    that.dropStaticParticipant = function (id, callback) {
        log.info(`dropStaticParticipant, id: ${id}`);
        let idx = staticParticipants.findIndex(i => i._id == id);
        if(idx >= 0){
            staticParticipants.splice(idx, 1);
            that.setInputOverlay(idx, [], ()=>{});
            engine.setAvatar(idx, null);

            inputManager.getStaticInputs().forEach(i=>{
                engine.removeInput(i.id);
            })
            inputManager.setStaticInput(staticParticipants.length, [idx]);
            inputManager.getStaticInputs().forEach(i=>{
                engine.addInput(i.id, i.codec, i.conn, i.avatar);
            })

            layoutProcessor.setStaticInputNum(staticParticipants.length);

            // TODO: deal with overlays?
            staticParticipants.forEach((i, idx) => {
                if(i.avatarData){
                    engine.setAvatar(idx, i.avatarData);
                }
                if(i.overlays)
                    that.setInputOverlay(idx, i.overlays, ()=>{});
            })
            engine.setAvatar(staticParticipants.length, null);

            callback('callback', true);
        } else {
            callback('callback', false);
        }
    }

    that.updateStaticParticipant = function (id, updated, callback) {
        log.info(`updateStaticParticipant, id: ${id}`);
        let idx = staticParticipants.findIndex(i => i._id == id);
        let found = staticParticipants[idx];
        if(idx == -1)idx = staticParticipants.length ;

        if(updated.avatarData)
            updated.avatarData = new Buffer(updated.avatarData.data || updated.avatarData, "base64");
        else if(updated.avatarData === null || !found)
            updated.avatarData = new Buffer(BlackPNG1px, "base64");
            
        updated.avatarData && engine.setAvatar(idx, updated.avatarData);

        if(updated.overlays){
            updated.overlays.forEach(i => {
                if(i.imageData){
                    i.imageData = new Buffer(i.imageData.data || i.imageData, "base64");
                }
            })
            // TODO: use callback?
            that.setInputOverlay(idx, updated.overlays, ()=>{});
        }

        if(found){
            Object.assign(found, updated);
        } else {
            staticParticipants.push(updated);
            inputManager.setStaticInput(staticParticipants.length);
            layoutProcessor.setStaticInputNum(staticParticipants.length);
        }

        callback('callback', true);
    }

    that.setLayout = function (layout, callback) {
        log.debug('setLayout, layout:', JSON.stringify(layout));

        // ignored StreamId specifier.

        var current_streams = inputManager.getStreamList().map((stream_id) => {
            return inputManager.get(stream_id);
        });

        // set static
        layout.forEach(i=>delete i.input);
        layout.slice(0,inputManager.staticInput).forEach((i,idx)=>i.input=idx);

        // set others
        current_streams.filter(i=>i.id>=inputManager.staticInput)
            .forEach((obj) => {
                let found = layout.slice(inputManager.staticInput).find(i=>i.input===undefined);
                if(found){
                    found.input = obj.id;
                }
            });

        var inputLayout = layout.filter(i=>i.region.area.width.numerator&&i.region.area.height.numerator);

        layoutProcessor.setLayout(inputLayout, function(layoutSolution) {
          callback('callback', formatLayoutSolution(layoutSolution));
        }, function(err) {
          callback('callback', 'error', 'layoutProcessor failed');
        });

        return inputLayout;
    };

    that.setScene = function (scene, callback) {
        log.debug('setScene, scene:', JSON.stringify(scene));

        let sceneSolution = {...scene};

        sceneSolution.layout = that.setLayout(scene.layout, callback);

        layoutProcessor.emit("sceneChange", sceneSolution);
    };

    that.getVisibleStreams = function (callback) {
        let visibleRegion = layoutProcessor.layoutSolution.filter(i=>i.region.area.width&&i.region.area.height);

        var stream_ids = visibleRegion.map((o) => {
            return inputManager.getStreamFromInput(o.input);
        });

        callback('callback', stream_ids);
    };

    that.forceKeyFrame = function (stream_id) {
        log.debug('forceKeyFrame, stream_id:', stream_id);
        if (outputs[stream_id] && engine) {
            engine.forceKeyFrame(stream_id);
        }
    };

    that.drawText = function (textSpec, duration) {
        log.debug('drawText, textSpec:', textSpec, 'duration:', duration);
        if (drawing_text_tmr) {
          clearTimeout(drawing_text_tmr);
          drawing_text_tmr = undefined;
        }

        engine.drawText(textSpec);

        if (duration > 0) {
            drawing_text_tmr = setTimeout(() => {engine.clearText();}, duration);
        }
    };


    return that;
};

function VTranscoder(rpcClient, clusterIP) {
    var that = {},
        engine,
        controller,

        drawing_text_tmr,

        motion_factor = 1.0,
        default_resolution = {width: 0, height: 0},
        default_framerate = 30,
        default_kfi = 1000,

        input_id = undefined,
        input_conn = undefined,

        /*{StreamID : {codec: 'vp8' | 'h264' |...,
                       resolution: {width: Number(Width), height: Number(Height)},
                       framerate: Number(FPS),
                       bitrate: Number(Kbps),
                       kfi: Number(KeyFrameIntervalSeconds),
                       dispatcher: Dispather,
                       }}*/
        outputs = {},

        /*{ConnectionID: {video: StreamID | undefined,
                          connection: InternalOut}
                         }
         }
         */
        connections = {};

    var setInput = function (stream_id, codec, options, on_ok, on_error) {
        // FIXME: filter profile setting for native layer
        codec = codec.indexOf('h264') > -1 ? 'h264' : codec;
        if (engine) {
            var conn = internalConnFactory.fetch(stream_id, 'in');
            if (!conn) {
                on_error('Create internal connection failed.');
                return;
            }
            conn.connect(options);

            if (engine.setInput(stream_id, codec, conn)) {
                input_id = stream_id;
                input_conn = conn;
                log.debug('setInput ok, stream_id:', stream_id, 'codec:', codec, 'options:', options);
                on_ok(stream_id);
            } else {
                internalConnFactory.destroy(stream_id, 'in');
                on_error('Failed in setting input to video-engine.');
            }
        } else {
            on_error('Video-transcoder engine is not ready.');
        }
    };

    var unsetInput = function () {
        if (input_id) {
            engine.unsetInput(input_id);
            internalConnFactory.destroy(input_id, 'in');
            input_id = undefined;
            input_conn = undefined;
        }
    };

    var addOutput = function (codec, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error) {
        log.info('addOutput: codec', codec, 'resolution:', resolution, 'framerate:', framerate, 'bitrate:', bitrate, 'keyFrameInterval:', keyFrameInterval);
        if (engine) {
            var stream_id = Math.random() * 1000000000000000000 + '';
            var dispatcher = new MediaFrameMulticaster();
            if (engine.addOutput(stream_id,
                                 codec,
                                 resolution2String(resolution),
                                 framerate,
                                 bitrate,
                                 keyFrameInterval,
                                 dispatcher)) {
                outputs[stream_id] = {codec: codec,
                                      resolution: resolution,
                                      framerate: framerate,
                                      bitrate: bitrate,
                                      kfi: keyFrameInterval,
                                      dispatcher: dispatcher,
                                      connections: {}};
                log.debug('addOutput ok, stream_id:', stream_id);
                on_ok(stream_id);
            } else {
                on_error('Failed in yielding output');
            }
        } else {
            on_error('Video-transcoder engine is not ready.');
        }
    };

    var removeOutput = function (stream_id) {
        if (outputs[stream_id]) {
            var output = outputs[stream_id];
            for (var connectionId in output.connections) {
                 output.dispatcher.removeDestination('video', output.connections[connectionId].receiver());
                 output.connections[connectionId].close();
                 delete output.connections[connectionId];
            }
            engine.removeOutput(stream_id);
            output.dispatcher.close();
            delete outputs[stream_id];
        }
    };

    var getOutput = function (stream_id) {
        if (outputs[stream_id]) {
            return {
                id: stream_id,
                resolution: outputs[stream_id].resolution,
                framerate: outputs[stream_id].framerate,
                bitrate: outputs[stream_id].bitrate,
                keyFrameInterval: outputs[stream_id].kfi
            };
        } else {
            return undefined;
        }
    };

    that.initialize = function (motionFactor, ctrlr, callback) {
        log.debug('to initialize video transcoder');
        var config = {
            'hardware': useHardware,
            'simulcast': false,
            'crop': false,
            'gaccplugin': gaccPluginEnabled,
            'MFE_timeout': MFE_timeout
        };

        controller = ctrlr;

        engine = new VideoTranscoder(config);

        motion_factor = (motionFactor || 1.0);
        log.info('Video transcoding engine init OK, supported_codecs:', supported_codecs);
        callback('callback', {codecs: supported_codecs});
    };

    that.deinit = function () {
        if (drawing_text_tmr) {
          clearTimeout(drawing_text_tmr);
          drawing_text_tmr = undefined;
        }

        for (var stream_id in outputs) {
            removeOutput(stream_id);
        }
        input_id && unsetInput(input_id);

        if (engine) {
            engine.close();
            engine = undefined;
        }
    };

    that.close = function() {
        if (engine) {
            that.deinit();
        }
    };

    that.onFaultDetected = function (message) {
        if (message.purpose === 'conference' && controller) {
            if ((message.type === 'node' && message.id === controller) ||
                (message.type === 'worker' && controller.startsWith(message.id))) {
                log.error('Conference controller (type:', message.type, 'id:', message.id, ') fault is detected, exit.');
                that.deinit();
                process.exit();
            }
        }
    };

    that.createInternalConnection = function (connectionId, direction, internalOpt, callback) {
        internalOpt.minport = global.config.internal.minport;
        internalOpt.maxport = global.config.internal.maxport;
        var portInfo = internalConnFactory.create(connectionId, direction, internalOpt);
        callback('callback', {ip: clusterIP, port: portInfo});
    };

    that.destroyInternalConnection = function (connectionId, direction, callback) {
        internalConnFactory.destroy(connectionId, direction);
        callback('callback', 'ok');
    };

    that.generate = function (codec, resolution, framerate, bitrate, keyFrameInterval, callback) {
        log.info('generate, codec:', codec, 'resolution:', resolution, 'framerate:', framerate, 'bitrate:', bitrate, 'keyFrameInterval:', keyFrameInterval);
        codec = (codec || supported_codecs.encode[0]).toLowerCase();
        resolution = (resolution === 'unspecified' ? default_resolution : resolution);
        framerate = (framerate === 'unspecified' ? default_framerate : framerate);
        var bitrate_factor = (typeof bitrate === 'string' ? (bitrate === 'unspecified' ? 1.0 : (Number(bitrate.replace('x', '')) || 0)) : 0);
        bitrate = (bitrate_factor ? calcDefaultBitrate(codec, resolution, framerate, motion_factor) * bitrate_factor : bitrate);
        keyFrameInterval = (keyFrameInterval === 'unspecified' ? default_kfi : keyFrameInterval);

        for (var stream_id in outputs) {
            if (outputs[stream_id].codec === codec &&
                isResolutionEqual(outputs[stream_id].resolution, resolution) &&
                outputs[stream_id].framerate === framerate &&
                outputs[stream_id].bitrate === bitrate &&
                outputs[stream_id].kfi === keyFrameInterval) {
                callback('callback', getOutput(stream_id));
                return;
            }
        }

        if (supported_codecs.encode.findIndex((c) => (c.toLowerCase() === codec)) < 0) {
            log.error('Not supported codec: '+codec);
            callback('callback', 'error', 'Not supported codec.');
            return;
        }

        addOutput(codec, resolution, framerate, bitrate, keyFrameInterval, function (stream_id) {
            callback('callback', getOutput(stream_id));
        }, function (error_reason) {
            log.error(error_reason);
            callback('callback', 'error', error_reason);
        });
    };

    that.degenerate = function (stream_id) {
        log.info('degenerate, stream_id:', stream_id);
        removeOutput(stream_id);
    };

    that.publish = function (stream_id, stream_type, options, callback) {
        log.info('publish, stream_id:', stream_id, 'stream_type:', stream_type, 'options:', options);
        if (stream_type !== 'internal') {
            return callback('callback', 'error', 'can not publish a stream to video engine through a non-internal connection');
        }

        if (options.video === undefined || options.video.codec === undefined) {
            return callback('callback', 'error', 'can not publish a stream to video engine without proper video codec');
        }

        if (input_id === undefined) {
            setInput(stream_id, options.video.codec, options, function () {
                callback('callback', {ip: clusterIP, port: input_conn.getListeningPort()});
            }, function (error_reason) {
                log.error(error_reason);
                callback('callback', 'error', error_reason);
            });
        } else if (input_id === stream_id) {
            callback('callback', {ip: clusterIP, port: input_conn.getListeningPort()});
        } else {
            log.error('input already exists.');
            callback('callback', 'error', 'input already exists.');
        }
    };

    that.unpublish = function (stream_id) {
        log.info('unpublish, stream_id:', stream_id);
        unsetInput(stream_id);
    };

    that.subscribe = function (connectionId, connectionType, options, callback) {
        log.info('subscribe, connectionId:', connectionId, 'connectionType:', connectionType, 'options:', options);
        if (connectionType !== 'internal') {
            return callback('callback', 'error', 'can not subscribe a stream from video engine through a non-internal connection');
        }

        var conn = internalConnFactory.fetch(connectionId, 'out');
        if (!conn) {
            callback('callback', 'error', 'Create internal connection failed.');
            return;
        }
        conn.connect(options);

        if (connections[connectionId] === undefined) {
            connections[connectionId] = {videoFrom: undefined,
                                         connection: conn
                                        };
        }
        callback('callback', 'ok');
    };

    that.unsubscribe = function (connectionId) {
        log.info('unsubscribe, connectionId:', connectionId);
        if (connections[connectionId] && connections[connectionId].videoFrom) {
            if (outputs[connections[connectionId].videoFrom]) {
                outputs[connections[connectionId].videoFrom].dispatcher.removeDestination('video', connections[connectionId].connection.receiver());
            }
            internalConnFactory.destroy(connectionId, 'out');
            delete connections[connectionId];
        }
    };

    that.linkup = function (connectionId, audio_stream_id, video_stream_id, data_stream_id, callback) {
        log.debug('linkup, connectionId:', connectionId, 'video_stream_id:', video_stream_id);
        if (connections[connectionId] === undefined) {
            return callback('callback', 'error', 'connection does not exist');
        }

        if (outputs[video_stream_id]) {
            outputs[video_stream_id].dispatcher.addDestination('video', connections[connectionId].connection.receiver());
            connections[connectionId].videoFrom = video_stream_id;
            callback('callback', 'ok');
        } else {
            log.error('Stream does not exist!', video_stream_id);
            callback('callback', 'error', 'Stream does not exist!');
        }
    };

    that.cutoff = function (connectionId) {
        log.debug('cutoff, connectionId:', connectionId);
        if (connections[connectionId] && connections[connectionId].videoFrom) {
            if (outputs[connections[connectionId].videoFrom]) {
                outputs[connections[connectionId].videoFrom].dispatcher.removeDestination('video', connections[connectionId].connection.receiver());
            }
            connections[connectionId].videoFrom = undefined;
        }
    };

    that.forceKeyFrame = function (stream_id) {
        if (outputs[stream_id] && engine) {
            engine.forceKeyFrame(stream_id);
        }
    };

    that.drawText = function (textSpec, duration) {
        log.debug('drawText, textSpec:', textSpec, 'duration:', duration);
        if (drawing_text_tmr) {
          clearTimeout(drawing_text_tmr);
          drawing_text_tmr = undefined;
        }

        engine.drawText(textSpec);

        if (duration > 0) {
            drawing_text_tmr = setTimeout(() => {engine.clearText();}, duration);
        }
    };

    return that;
};

module.exports = function (rpcClient, selfRpcId, parentRpcId, clusterWorkerIP) {
    var that = {
      agentID: parentRpcId,
      clusterIP: clusterWorkerIP
    },
        processor = undefined;

    that.init = function (service, config, belongTo, controller, mixView, callback) {
        if (processor === undefined) {
            if (service === 'mixing') {
                processor = new VMixer(rpcClient, clusterWorkerIP);
                processor.initialize(config, belongTo, controller, mixView, callback);
                that.__proto__ = processor;
            } else if (service === 'transcoding') {
                processor = new VTranscoder(rpcClient, clusterWorkerIP);
                processor.initialize(config.motionFactor, controller, callback);
                that.__proto__ = processor;
            } else {
                log.error('Unknown service type to init a video node:', service);
                callback('callback', 'error', 'Unknown service type to init a video node.');
            }
        } else {
            log.error('Repetitive initialization, service:', service);
            callback('callback', 'error', 'Repetitive initialization.');
        }
    };

    that.deinit = function () {
        processor && processor.deinit();
        processor = undefined;
    };

    return that;
};
