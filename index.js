require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const kill = require('tree-kill');

const app = express();
const upload = multer({ dest: 'uploads/' });

let streams = [];
let lastUploadedImagePath = null;

const maxStreams = parseInt(process.env.MAX_STREAMS, 10) || 5;

const maskHP = (url) => url
	.split('/')
	.map(part => part
		.split('')
		.map((c, i, { length }) => (i < 3 || i > length - 4) ? c : '*')
		.join('')
	)
	.join('/');

app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.set('view engine', 'ejs');

app.get('/favicon.ico', (req, res) => {
	if (lastUploadedImagePath) {
		res.sendFile(path.join(__dirname, 'favicon.ico'));
	} else {
		res.status(404).send('Favicon not found');
	}
});

app.get('/', (req, res) => {
	res.render('index', {
		streams,
		maxStreams,
	});
});

app.post('/start-stream', upload.single('image'), async (req, res) => {
	if (streams.length >= maxStreams) {
		res.redirect('/');

		return;
	}

	const imagePath = req.file.path;
	const hostPath = req.body.hostPath;
	const radio = req.body.radio;

	if (!hostPath || hostPath.indexOf('rtmp://') !== 0 || !radio) {
		return res.redirect('https://www.youtube.com/watch?v=9f8dGAsAlbo');
	}

	const originalImagePath = req.file.path;
	const processedImagePath = path.join('uploads', `processed-${Date.now()}.png`);

	try {
		await sharp(originalImagePath)
			.resize(640, 360, {
				fit: 'contain',
				background: { r: 0, g: 0, b: 0, alpha: 1 }
			})
			.toFile(processedImagePath);

		await sharp(originalImagePath)
			.resize(32, 32)
			.toFile('favicon.ico');

		lastUploadedImagePath = processedImagePath;
	} catch (error) {
		console.error('Error processing image:', error);
		res.status(500).send('Error processing image');

		return;
	}

	const scriptPath = path.join(__dirname, 'start_stream.sh');
	const command = `bash ${scriptPath} "${processedImagePath}" "${radio}" "${hostPath}"`;

	const ffmpegProcess = exec(command, { env: process.env }, (error, stdout, stderr) => {
		if (error) {
			console.error(`exec error: ${error}`);
			return;
		}
		console.log(`stdout: ${stdout}`);
		console.error(`stderr: ${stderr}`);
	});

	console.log('Start stream to:', hostPath);

	const stream = {
		id: Date.now(),
		imagePath,
		processedImagePath,
		title: maskHP(hostPath),
		hostPath,
		process: ffmpegProcess,
		failed: false,
	};

	ffmpegProcess.on('error', (err) => {
		console.error('Failed to start ffmpeg:', err);

		const streamIndex = streams.findIndex(s => s.id === stream.id);

		if (streamIndex >= 0) {
			streams[streamIndex].failed = true;
		}
	});

	ffmpegProcess.on('close', (code) => {
		console.log(`ffmpeg process exited with code ${code}`);

		const streamIndex = streams.findIndex(s => s.id === stream.id);

		if (streamIndex >= 0) {
			streams[streamIndex].failed = true;
		}
	});

	streams.push(stream);

	res.redirect('/');
});

app.post('/stop-stream/:id', (req, res) => {
	const streamId = parseInt(req.params.id, 10);
	const streamIndex = streams.findIndex(s => s.id === streamId);

	if (streamIndex >= 0) {
		const stream = streams[streamIndex];

		kill(stream.process.pid, 'SIGTERM', (err) => {
			if (err) {
				console.error('Failed to kill process:', err);
				res.redirect('/');
			} else {
				console.log(`Process ${stream.process.pid} killed`);
				fs.unlink(stream.imagePath, (err) => {
					if (err) console.error('Failed to delete image:', err);
				});
				fs.unlink(stream.processedImagePath, (err) => {
					if (err) console.error('Failed to delete image:', err);
				});
				streams.splice(streamIndex, 1);
				res.redirect('/');
			}
		});
	}
});

// TODO
// app.post('/reload-stream/:id', (req, res) => {
// 	const streamId = parseInt(req.params.id, 10);
// 	const streamIndex = streams.findIndex(s => s.id === streamId);

// 	if (streamIndex >= 0) {
// 		const stream = streams[streamIndex];
// 		// kill
// 		// start
// 	}
// });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
