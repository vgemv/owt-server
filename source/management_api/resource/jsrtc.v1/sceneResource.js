// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
var dataAccess = require('../../data_access');
var requestHandler = require('../../requestHandler');
var e = require('../../errors');

var logger = require('../../logger').logger;

// Logger
var log = logger.getLogger('SceneResource');


exports.create = function (req, res, next) {
    var authData = req.authData;

    if (typeof req.body !== 'object' || req.body === null || typeof req.body.name !== 'string' || req.body.name === '') {
        return next(new e.BadRequestError('Invalid request body'));
    }

    if (req.body.options && typeof req.body.options !== 'object') {
        return next(new e.BadRequestError('Invalid scene option'));
    }
    req.body.options = req.body.options || {};

    var options = req.body.options;
    options.name = req.body.name;
    var optionsCopy = {...options, overlays: options.overlays.map(i=>({...i}))};
    dataAccess.room.createScene(authData.service._id, req.params.room, optionsCopy, function(err, result) {
        if (!err && result) {
            log.debug('Scene created:', req.body.name, 'for service', authData.service.name);
            requestHandler.updateScene(req.params.room, result._id.toString(), options, ()=>{});
            res.send(result);
        } else {
            log.info('Scene creation failed', err ? err.message : options);
            next(err || new e.AppError('Create scene failed'));
        }
    });
};

exports.get = function (req, res, next) {
    var authData = req.authData;
    dataAccess.room.getScene(authData.service._id, req.params.room, req.params.scene, function(err, scene) {
        if(err){
            next(err);
        }
        if (!scene) {
            log.info('Scene ', req.params.scene, ' does not exist');
            next(new e.NotFoundError('Scene not found'));
        } else {
            log.info('Representing scene ', scene._id, 'of service ', authData.service._id);
            if(scene.bgImageData && scene.bgImageData.data)
                scene.bgImageData = scene.bgImageData.data.toString('base64');
            scene.overlays.forEach(o => {
                if(o.imageData && o.imageData.data)
                    o.imageData = o.imageData.data.toString('base64');
            })
            res.send(scene);
        }
    });
};

exports.update = function (req, res, next) {
    var authData = req.authData;
    var obj = req.body;
    obj._id = req.params.scene;
    var objCopy = {...obj, overlays: obj.overlays.map(i=>({...i}))};
    dataAccess.room.updateScene(authData.service._id, req.params.room, objCopy, function(err, ret) {
        if(err){
            next(err);
        }
        if (!ret) {
            log.info('Scene ', req.params.scene, ' update failed: ' + err);
            next(err);
        } else {
            log.info('Updated scene ', ret._id, 'of room ', req.params.room);
            requestHandler.updateScene(req.params.room, ret._id.toString(), obj, ()=>{});
            res.send(ret);
        }
    });
};

exports.delete = function (req, res, next) {
    var authData = req.authData;
    dataAccess.room.deleteScene(authData.service._id, req.params.room, req.params.scene, function(err, sceneId) {
        if(err){
            next(err);
        }
        if (!sceneId) {
            log.info('Scene ', req.params.scene, ' delete failed: ' + err);
            next(err);
        } else {
            log.info('Deleted scene ', sceneId, 'of room ', req.params.room);
            requestHandler.deleteScene(req.params.room, sceneId, ()=>{});
            res.send(sceneId);
        }
    });
};

exports.list = function (req, res, next) {
    var authData = req.authData;
    req.query.page = Number(req.query.page) || undefined;
    req.query.per_page = Number(req.query.per_page) || undefined;
    dataAccess.room.listScene(authData.service._id, req.params.room, req.query, function(err, scenes) {
        if(err){
            next(err);
        }
        if (!scenes) {
            log.info('Room.scenes ', req.params.room, ' listing failed: ' + err);
            next(err);
        } else {
            log.info('Listing scenes of room ', req.params.room, ': ', scenes);
            res.send(scenes);
        }
    });
};
