require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
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
			.resize(1280, 720, {
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

	const ffmpegProcess = spawn('ffmpeg', [
		'-framerate', '15',
		'-re', '-loop', '1',
		'-i', processedImagePath,
		'-i', radio,
		'-vcodec', 'libx264',
		'-pix_fmt', 'yuv420p',
		'-preset', 'slow',
		'-r', '15',
		'-g', '30',
		'-f', 'flv',
		hostPath,
	]);

	console.log('Start stream to:', hostPath);

	ffmpegProcess.on('error', (err) => {
		console.error('Failed to start ffmpeg:', err);
	});

	ffmpegProcess.on('close', (code) => {
		console.log(`ffmpeg process exited with code ${code}`);
	});

	const stream = {
		id: Date.now(),
		imagePath,
		hostPath: maskHP(hostPath),
		process: ffmpegProcess
	};

	streams.push(stream);

	res.redirect('/');
});

app.post('/stop-stream/:id', (req, res) => {
	const streamId = parseInt(req.params.id, 10);
	const streamIndex = streams.findIndex(s => s.id === streamId);

	if (streamIndex !== -1) {
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
				streams.splice(streamIndex, 1);
				res.redirect('/');
			}
		});
	}
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
