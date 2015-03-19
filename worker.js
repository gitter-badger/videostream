var MP4Box = require('mp4box');

module.exports = function (self) {
	var mp4box = new MP4Box();
	var tracks = {}; // keyed by id
	var fileLength;

	mp4box.onError = function (e) {
		console.error('MP4Box error:');
		console.error(e);
	};

	mp4box.onReady = function (metadata) {
		console.log('metadata:');
		console.log(metadata);

		send({ type: 'metadata', data: metadata });

		metadata.tracks.forEach(function (track) {
			tracks[track.id] = track;
			mp4box.setSegmentOptions(track.id, null, {
				nbSamples: 500
			});
		});

		var initSegs = mp4box.initializeSegmentation();
		initSegs.forEach(function (initSegment) {
			send({
				type: 'segment',
				trackId: initSegment.id,
				buffer: initSegment.buffer,
				ended: false
			});
		});
		ready = true;
	};

	mp4box.onSegment = function (trackId, user, buffer, nextSample) {
		console.log('got segment; nextSample:', nextSample);
		var track = tracks[id];
		var ended = (nextSample === track.nb_samples);
		send({
			type: 'segment',
			trackId: trackId,
			buffer: buffer,
			ended: ended
		});
	};

	function send (message) {
		self.postMessage(message);
	}

	function onMessage (event) {
		var message = event.data;
		if (message.type === 'init') {
			fileLength = message.data.fileLength;
		} else if (message.type === 'buffer') {
			handleBuffer(message.data);
		} else {
			throw new Error('unexpected message', message)
		}
	}
	self.addEventListener('message', onMessage, false);
}

var desiredIngestOffset = 0;

function handleBuffer (buffer) {
	var newDesiredIngestOffset = mp4box.appendBuffer(arrayBuffer);
	if (newDesiredIngestOffset !== desiredIngestOffset + arrayBuffer.byteLength) {
		send({ type: 'offset', data: newDesiredIngestOffset });
	}
	desiredIngestOffset = newDesiredIngestOffset;

	if (arrayBuffer.fileStart + arrayBuffer.byteLength === fileLength) {
		mp4box.flush();
	}

}
