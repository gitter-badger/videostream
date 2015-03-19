var WebTorrent = require('webtorrent');
var work = require('webworkify');

var video = document.querySelector('video');

var client = new WebTorrent();
var infoHash = 'a54c3ee75cb901001e46da2072ed7bfde7a5374e';

var mediaSource;
var file;

client.add({
	infoHash: infoHash,
	announce: 'wss://tracker.webtorrent.io/'
}, function (torrent) {
	// Got torrent metadata!
	console.log('Torrent info hash:', torrent.infoHash);

	// Let's say the first file is a webm (vp8) or mp4 (h264) video...
	file = torrent.files[0]

	send({ type: 'init', data: { fileLength: file.length }})

	video.addEventListener('waiting', function () {
		if (ready) {
			seek(video.currentTime);
		}
	});

	mediaSource = new MediaSource();
	mediaSource.addEventListener('sourceopen', function () {
		makeRequest();
	});
	video.src = window.URL.createObjectURL(mediaSource);
});

var ready = false;
var tracks = {}; // keyed by id

var worker = work(require('./worker.js'));

worker.addEventListener('message', function (event) {
	var message = event.data;
	if (message.type === 'metadata') {
		handleMetadata(message.data)
	} else (message.type === 'segment') {
		appendBuffer(message.trackId, message.buffer, message.ended)
	} else (message.type === 'offset') {
		handleOffset(message.data)
	} else {
		throw new Error('unexpected message', message)
	}
});

function handleMetadata (metadata) {
	metadata.tracks.forEach(function (track) {
		var mime = 'video/mp4; codecs="' + track.codec + '"';
		if (MediaSource.isTypeSupported(mime)) {
			var sourceBuffer = mediaSource.addSourceBuffer(mime);
			var trackEntry = {
				buffer: sourceBuffer,
				arrayBuffers: [],
				meta: track,
				ended: false
			};
			sourceBuffer.addEventListener('updateend', popBuffers.bind(null, trackEntry));
			tracks[track.id] = trackEntry;
		}
	});
}

function handleOffset (offset) {

}

function send (message, transferable) {
	worker.postMessage(message, transferable);
}

var desiredIngestOffset = 0;
var downloadBusy = false;
function makeRequest () {
	if (downloadBusy) {
		return;
	}
	downloadBusy = true;
	var requestOffset = desiredIngestOffset;
	var opts = {
		start: requestOffset,
		end: Math.min(file.length - 1, requestOffset + 100000)
	};
	console.log('request opts:', opts);
	var stream = file.createReadStream(opts); //, function (err, stream) {
	// if (err) return console.error(err);
	stream.on('data', function (data) {
		console.log('data, length: ', data.length);
		// console.log(data.toString('hex'));
		var arrayBuffer = data.toArrayBuffer(); // TODO: avoid copy
		arrayBuffer.fileStart = requestOffset;

		// if (desiredIngestOffset !== requestOffset) {
		//   console.warn('moving');
		// }

		requestOffset += arrayBuffer.byteLength;

		send({ type: 'buffer', data: arrayBuffer }, [ arrayBuffer ]);
	});
	stream.on('end', function () {
		console.log('end');
		downloadBusy = false;
		if (requestOffset === file.length) {
			mp4box.flush();
		}
		if (desiredIngestOffset !== file.length) {
			makeRequest();
		}
	});
	// });
}

// downloader: specify desired offset, get data events with offsets

function seek (seconds) {
	var seekResult = mp4box.seek(seconds, true);
	console.log('seeking to: ', seconds, ' result: ', seekResult);
	desiredIngestOffset = seekResult.offset;
	console.log('seeked offset:', desiredIngestOffset);
	makeRequest();
}

function appendBuffer (trackId, buffer, ended) {
	var track = tracks[trackId];
	track.arrayBuffers.push({
		buffer: buffer,
		ended: ended || false
	});
	popBuffers(track);
}

function popBuffers (track) {
	updateEnded(); // set call endOfStream() if needed
	if (track.buffer.updating || track.arrayBuffers.length === 0) return;
	var buffer = track.arrayBuffers.shift();
	try {
		track.buffer.appendBuffer(buffer.buffer);
		track.ended = buffer.ended;
	} catch (e) {
		console.warn('error: ', e);
		track.arrayBuffers.unshift(buffer);
	}
	updateEnded();
}

function updateEnded () {
	if (mediaSource.readyState !== 'open') {
		return;
	}

	var ended = Object.keys(tracks).every(function (id) {
		var track = tracks[id];
		return track.ended && !track.buffer.updating;
	});

	if (ended) {
		console.warn('ended');
		mediaSource.endOfStream();
	}
}
