const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('alambic', {
	status: () => ipcRenderer.invoke('app:status'),
	pickFiles: () => ipcRenderer.invoke('files:pick'),
	addFiles: (files) => ipcRenderer.invoke('files:add', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
	removeFile: (id) => ipcRenderer.invoke('files:remove', id),
	pickFolder: () => ipcRenderer.invoke('folder:pick'),
	analyze: (id) => ipcRenderer.invoke('media:analyze', id),
	decodeFrame: (id, index, bytes) => ipcRenderer.invoke('media:decode-frame', id, index, bytes),
	decodeFinish: (id, durations) => ipcRenderer.invoke('media:decode-finish', id, durations),
	raster: (id, bytes) => ipcRenderer.invoke('media:raster', id, bytes),
	thumb: (id) => ipcRenderer.invoke('media:thumb', id),
	waveform: (id, color) => ipcRenderer.invoke('media:waveform', id, color),
	preview: (id, recipe, time) => ipcRenderer.invoke('media:preview', id, recipe, time),
	run: (jobId, id, recipe, outputDir) => ipcRenderer.invoke('job:run', jobId, id, recipe, outputDir),
	cancel: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
	save: (id, ext, bytes, outputDir, suffix) => ipcRenderer.invoke('file:save', id, ext, bytes, outputDir, suffix),
	reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
	download: (jobId, url, mode) => ipcRenderer.invoke('link:download', jobId, url, mode),
	cancelDownload: (jobId) => ipcRenderer.invoke('link:cancel', jobId),
	updateYtdlp: () => ipcRenderer.invoke('link:update'),
	onDownload: (callback) => {
		const listener = (_event, jobId, payload) => callback(jobId, payload);
		ipcRenderer.on('link:progress', listener);
		return () => ipcRenderer.removeListener('link:progress', listener);
	},
	modelStatus: () => ipcRenderer.invoke('models:status'),
	downloadModel: (name) => ipcRenderer.invoke('models:download', name),
	cancelModel: (name) => ipcRenderer.invoke('models:cancel', name),
	onModelProgress: (callback) => {
		const listener = (_event, name, ratio) => callback(name, ratio);
		ipcRenderer.on('models:progress', listener);
		return () => ipcRenderer.removeListener('models:progress', listener);
	},
	toolStatus: () => ipcRenderer.invoke('tools:status'),
	installTool: (name) => ipcRenderer.invoke('tools:install', name),
	cancelTool: (name) => ipcRenderer.invoke('tools:cancel', name),
	onToolProgress: (callback) => {
		const listener = (_event, name, ratio) => callback(name, ratio);
		ipcRenderer.on('tools:progress', listener);
		return () => ipcRenderer.removeListener('tools:progress', listener);
	},
	onProgress: (callback) => {
		const listener = (_event, jobId, ratio) => callback(jobId, ratio);
		ipcRenderer.on('job:progress', listener);
		return () => ipcRenderer.removeListener('job:progress', listener);
	},
});
