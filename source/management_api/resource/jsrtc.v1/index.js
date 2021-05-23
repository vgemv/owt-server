// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
/*
 * Router for v1.1 interfaces
 */
'use strict';
var express = require('express')
var router = express.Router()
var sceneResource = require('./sceneResource');
var staticParticipantResource = require('./staticParticipantResource');

//Stream(including external streaming-in) management
router.get('/rooms/:room/scene', sceneResource.list);
router.post('/rooms/:room/scene', sceneResource.create);
router.get('/rooms/:room/scene/:scene', sceneResource.get);
router.put('/rooms/:room/scene/:scene', sceneResource.update);
router.delete('/rooms/:room/scene/:scene', sceneResource.delete);

router.get('/rooms/:room/staticparticipant', staticParticipantResource.list);
router.post('/rooms/:room/staticparticipant', staticParticipantResource.create);
router.get('/rooms/:room/staticparticipant/:id', staticParticipantResource.get);
router.put('/rooms/:room/staticparticipant/:id', staticParticipantResource.update);
router.delete('/rooms/:room/staticparticipant/:id', staticParticipantResource.delete);

module.exports = router
