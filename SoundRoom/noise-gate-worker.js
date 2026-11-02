'use strict';
importScripts('noise-gate.js');
self.onmessage=event=>{try{const {channels,rate,threshold,reduction}=event.data;SoundNoiseGate.apply(channels,rate,threshold,reduction);self.postMessage({channels},channels.map(channel=>channel.buffer));}catch(error){self.postMessage({error:error.message});}};
