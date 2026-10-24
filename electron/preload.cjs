const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** Electron préfixe les erreurs IPC (« Error invoking remote method … ») : l'interface ne reçoit que le message. */
const REMOTE_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch((error) => {
	throw new Error(String(error.message ?? error).replace(REMOTE_PREFIX, ''));
});

/** Même motif que electron/extension-host.js : le preload est un script isolé, il ne peut pas l'importer. */
const EXTENSION_CHANNEL = /^ext:[a-z0-9][a-z0-9:-]*$/;
const extensionChannel = (channel) => {
	if (typeof channel !== 'string' || !EXTENSION_CHANNEL.test(channel)) throw new Error(`Canal d'extension invalide : ${channel}`);
	return channel;
};

contextBridge.exposeInMainWorld('alambic', {
	ext: {
		invoke: (channel, ...args) => call(extensionChannel(channel), ...args),
		on: (channel, callback) => {
			const listener = (_event, ...payload) => callback(...payload);
			ipcRenderer.on(extensionChannel(channel), listener);
			return () => ipcRenderer.removeListener(channel, listener);
		},
	},
	status: () => call('app:status'),
	pickFiles: () => call('files:pick'),
	addFiles: (files) => call('files:add', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
	removeFile: (id) => call('files:remove', id),
	pickFolder: () => call('folder:pick'),
	analyze: (id) => call('media:analyze', id),
	decodeFrame: (id, index, bytes) => call('media:decode-frame', id, index, bytes),
	decodeFinish: (id, durations) => call('media:decode-finish', id, durations),
	raster: (id, bytes) => call('media:raster', id, bytes),
	thumb: (id) => call('media:thumb', id),
	waveform: (id, color) => call('media:waveform', id, color),
	preview: (id, recipe, time) => call('media:preview', id, recipe, time),
	run: (jobId, id, recipe, outputDir) => call('job:run', jobId, id, recipe, outputDir),
	cancel: (jobId) => call('job:cancel', jobId),
	save: (id, ext, bytes, outputDir, suffix) => call('file:save', id, ext, bytes, outputDir, suffix),
	reveal: (path) => call('shell:reveal', path),
	download: (jobId, url, mode) => call('link:download', jobId, url, mode),
	cancelDownload: (jobId) => call('link:cancel', jobId),
	updateYtdlp: () => call('link:update'),
	onDownload: (callback) => {
		const listener = (_event, jobId, payload) => callback(jobId, payload);
		ipcRenderer.on('link:progress', listener);
		return () => ipcRenderer.removeListener('link:progress', listener);
	},
	modelStatus: () => call('models:status'),
	downloadModel: (name) => call('models:download', name),
	cancelModel: (name) => call('models:cancel', name),
	onModelProgress: (callback) => {
		const listener = (_event, name, ratio) => callback(name, ratio);
		ipcRenderer.on('models:progress', listener);
		return () => ipcRenderer.removeListener('models:progress', listener);
	},
	toolStatus: () => call('tools:status'),
	installTool: (name) => call('tools:install', name),
	cancelTool: (name) => call('tools:cancel', name),
	onToolProgress: (callback) => {
		const listener = (_event, name, ratio) => callback(name, ratio);
		ipcRenderer.on('tools:progress', listener);
		return () => ipcRenderer.removeListener('tools:progress', listener);
	},
	pickLogo: () => call('logo:pick'),
	listPresets: () => call('presets:list'),
	savePreset: (name, recipe) => call('presets:save', name, recipe),
	removePreset: (name) => call('presets:remove', name),
	initialFiles: () => call('files:initial'),
	onOpened: (callback) => {
		const listener = (_event, items) => callback(items);
		ipcRenderer.on('files:opened', listener);
		return () => ipcRenderer.removeListener('files:opened', listener);
	},
	installUpdate: () => call('update:install'),
	onUpdateReady: (callback) => {
		const listener = (_event, info) => callback(info);
		ipcRenderer.on('update:ready', listener);
		return () => ipcRenderer.removeListener('update:ready', listener);
	},
	onProgress: (callback) => {
		const listener = (_event, jobId, ratio) => callback(jobId, ratio);
		ipcRenderer.on('job:progress', listener);
		return () => ipcRenderer.removeListener('job:progress', listener);
	},
});
