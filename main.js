const { Plugin, PluginSettingTab, Setting, ItemView, Modal, TFolder, TFile, Notice, setIcon } = require('obsidian');

const VIEW_TYPE_SOUNDBOARD = 'tabletop-kit-soundboard-view';
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm'];

const TTRPG_ICONS = [
	// Combat & Weapons
	{ id: 'swords', label: 'Melee Battle' },
	{ id: 'sword', label: 'Sword Strike' },
	{ id: 'axe', label: 'Axe / Cleave' },
	{ id: 'shield', label: 'Shield / Parry' },
	{ id: 'hand', label: 'Hand-to-Hand / Brawl' },
	{ id: 'crosshair', label: 'Archery / Ranged' },
	{ id: 'hammer', label: 'Warhammer / Blunt' },
	{ id: 'target', label: 'Critical Hit' },
	// Magic & Alchemy
	{ id: 'flame', label: 'Fire / Torch' },
	{ id: 'sparkles', label: 'Arcane Magic' },
	{ id: 'wand-2', label: 'Spellcast' },
	{ id: 'zap', label: 'Lightning Bolt' },
	{ id: 'flask-conical', label: 'Potion / Alchemy' },
	{ id: 'scroll', label: 'Scroll / Lore' },
	{ id: 'book-open', label: 'Spellbook' },
	{ id: 'eye', label: 'Scrying / Detection' },
	// Weather & Nature
	{ id: 'cloud-rain', label: 'Rain' },
	{ id: 'cloud-lightning', label: 'Thunderstorm' },
	{ id: 'cloud-snow', label: 'Blizzard' },
	{ id: 'snowflake', label: 'Frost / Ice' },
	{ id: 'wind', label: 'Wind / Gale' },
	{ id: 'trees', label: 'Forest / Woods' },
	{ id: 'mountain', label: 'Mountain / Cavern' },
	{ id: 'waves', label: 'Ocean / River' },
	{ id: 'sun', label: 'Day / Dawn' },
	{ id: 'moon', label: 'Night / Camp' },
	{ id: 'tent', label: 'Encampment' },
	// Monsters, Undead & Danger
	{ id: 'skull', label: 'Undead / Death' },
	{ id: 'ghost', label: 'Specter / Haunting' },
	{ id: 'bug', label: 'Swarm / Insect' },
	{ id: 'bird', label: 'Raven / Beast' },
	{ id: 'paw-print', label: 'Monster / Tracking' },
	{ id: 'bone', label: 'Skeleton / Remains' },
	{ id: 'alert-triangle', label: 'Trap / Ambush' },
	// Tavern, Dungeon & Exploration
	{ id: 'beer', label: 'Tavern / Inn' },
	{ id: 'utensils', label: 'Feast / Banquet' },
	{ id: 'music', label: 'Bard / Lute' },
	{ id: 'door-open', label: 'Creaking Door' },
	{ id: 'key', label: 'Unlock / Key' },
	{ id: 'lock', label: 'Locked Chest' },
	{ id: 'coins', label: 'Gold / Loot' },
	{ id: 'gem', label: 'Treasure / Jewel' },
	{ id: 'crown', label: 'Royalty / Throne' },
	{ id: 'castle', label: 'Castle / Keep' },
	{ id: 'compass', label: 'Exploration' },
	{ id: 'map', label: 'Overworld / Travel' },
	{ id: 'footprints', label: 'Footsteps / Stealth' },
	{ id: 'bell', label: 'Alarm / Church Bell' },
	{ id: 'anchor', label: 'Harbor / Ship' },
	// Dice & Misc
	{ id: 'dices', label: 'Dice Roll' },
	{ id: 'dice-6', label: 'Critical Roll' },
	{ id: 'volume-2', label: 'General Audio' }
];

const DEFAULT_SETTINGS = {
	atmosphereFolder: 'Sounds/Atmosphere',
	sfxFolder: 'Sounds/SFX',
	fadeInSeconds: 2.5,
	fadeOutSeconds: 2.5,
	crossfadeMode: 'simultaneous',
	autoLoopAtmosphere: true,
	masterVolume: 0.85,
	showFileExtensions: false,
	layoutMode: 'tiles', // 'tiles' or 'list'
	activeTab: 'all', // 'all', 'atmosphere', 'sfx'
	collapsedSections: {
		atmosphere: false,
		sfx: false
	},
	trackOverrides: {} // { [filePath]: { volume?: number, loop?: boolean, icon?: string } }
};

class TabletopKitSoundboardPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.activeAtmosphere = null;
		this.activeSfx = new Set();
		this.blobCache = new Map();

		this.registerView(
			VIEW_TYPE_SOUNDBOARD,
			(leaf) => new SoundboardView(leaf, this)
		);

		this.addRibbonIcon('volume-2', 'Open Tabletop Kit - Soundboard', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-soundboard',
			name: 'Open soundboard',
			callback: () => this.activateView()
		});

		this.addCommand({
			id: 'stop-all-sounds',
			name: 'Fade out and stop all sounds',
			callback: () => this.stopAllSounds(false)
		});

		this.addSettingTab(new SoundboardSettingTab(this.app, this));

		this.registerEvent(this.app.vault.on('create', () => this.refreshOpenViews()));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file && this.blobCache.has(file.path)) {
				URL.revokeObjectURL(this.blobCache.get(file.path));
				this.blobCache.delete(file.path);
			}
			this.refreshOpenViews();
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.blobCache.has(oldPath)) {
				URL.revokeObjectURL(this.blobCache.get(oldPath));
				this.blobCache.delete(oldPath);
			}
			if (this.settings.trackOverrides[oldPath]) {
				this.settings.trackOverrides[file.path] = this.settings.trackOverrides[oldPath];
				delete this.settings.trackOverrides[oldPath];
				this.saveData(this.settings);
			}
			this.refreshOpenViews();
		}));
	}

	onunload() {
		this.stopAllSounds(true);
		for (const url of this.blobCache.values()) {
			URL.revokeObjectURL(url);
		}
		this.blobCache.clear();
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.settings.collapsedSections = Object.assign(
			{},
			DEFAULT_SETTINGS.collapsedSections,
			(loaded && loaded.collapsedSections) || {}
		);
		this.settings.trackOverrides = Object.assign(
			{},
			(loaded && loaded.trackOverrides) || {}
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateLiveVolumes();
		this.refreshOpenViews();
	}

	getTrackConfig(file, category) {
		const ov = this.settings.trackOverrides[file.path] || {};
		const defaultLoop = category === 'atmosphere' ? this.settings.autoLoopAtmosphere : false;
		const defaultIcon = category === 'atmosphere' ? 'trees' : 'swords';
		return {
			volume: typeof ov.volume === 'number' ? ov.volume : 1.0,
			loop: typeof ov.loop === 'boolean' ? ov.loop : defaultLoop,
			icon: ov.icon || defaultIcon
		};
	}

	getEffectiveVolume(file, category) {
		const cfg = this.getTrackConfig(file, category);
		return Math.min(1, Math.max(0, cfg.volume * this.settings.masterVolume));
	}

	async setTrackOverride(filePath, patch) {
		const existing = this.settings.trackOverrides[filePath] || {};
		this.settings.trackOverrides[filePath] = Object.assign({}, existing, patch);
		await this.saveData(this.settings);
		this.updateLiveVolumes();
	}

	async activateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SOUNDBOARD);
		let leaf = leaves[0];

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_SOUNDBOARD, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	refreshOpenViews() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOUNDBOARD);
		for (const leaf of leaves) {
			if (leaf.view instanceof SoundboardView) {
				leaf.view.render();
			}
		}
	}

	getAudioFilesInFolder(folderPath) {
		const cleanPath = (folderPath || '').replace(/^\/+|\/+$/g, '');
		if (!cleanPath) return [];

		const folder = this.app.vault.getAbstractFileByPath(cleanPath);
		if (!(folder instanceof TFolder)) return [];

		return folder.children
			.filter((f) => f instanceof TFile && AUDIO_EXTENSIONS.includes(f.extension.toLowerCase()))
			.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
	}

	async getInstantAudioUrl(file) {
		if (this.blobCache.has(file.path)) {
			return this.blobCache.get(file.path);
		}
		try {
			const buffer = await this.app.vault.readBinary(file);
			const ext = file.extension.toLowerCase();
			const mimeMap = {
				mp3: 'audio/mpeg',
				wav: 'audio/wav',
				ogg: 'audio/ogg',
				flac: 'audio/flac',
				m4a: 'audio/mp4',
				webm: 'audio/webm'
			};
			const blob = new Blob([buffer], { type: mimeMap[ext] || 'audio/mpeg' });
			const url = URL.createObjectURL(blob);
			this.blobCache.set(file.path, url);
			return url;
		} catch (e) {
			return this.app.vault.getResourcePath(file);
		}
	}

	fadeAudio(audio, targetVolume, durationSeconds, onComplete) {
		let cancelled = false;
		const startVolume = audio.volume;
		const durationMs = Math.max(0, durationSeconds * 1000);

		if (durationMs === 0 || Math.abs(targetVolume - startVolume) < 0.001) {
			audio.volume = Math.min(1, Math.max(0, targetVolume));
			if (onComplete) onComplete();
			return () => { cancelled = true; };
		}

		const startTime = performance.now();

		const step = (now) => {
			if (cancelled) return;
			const elapsed = now - startTime;
			const progress = Math.min(1, elapsed / durationMs);
			const nextVol = startVolume + (targetVolume - startVolume) * progress;
			audio.volume = Math.min(1, Math.max(0, nextVol));

			if (progress < 1) {
				requestAnimationFrame(step);
			} else if (onComplete) {
				onComplete();
			}
		};

		requestAnimationFrame(step);
		return () => { cancelled = true; };
	}

	playAtmosphere(file) {
		if (this.activeAtmosphere && this.activeAtmosphere.path === file.path) {
			this.stopAtmosphere(false);
			return;
		}

		const previous = this.activeAtmosphere;

		const startIncoming = () => {
			const cfg = this.getTrackConfig(file, 'atmosphere');
			const targetVol = this.getEffectiveVolume(file, 'atmosphere');
			const url = this.app.vault.getResourcePath(file);
			const audio = new Audio(url);
			audio.loop = cfg.loop;
			audio.volume = 0;

			const entry = {
				path: file.path,
				file,
				audio,
				cancelFade: null
			};

			audio.addEventListener('ended', () => {
				if (!audio.loop && this.activeAtmosphere && this.activeAtmosphere.path === file.path) {
					this.activeAtmosphere = null;
					this.refreshOpenViews();
				}
			});

			audio.play().then(() => {
				entry.cancelFade = this.fadeAudio(audio, targetVol, this.settings.fadeInSeconds);
			}).catch((err) => {
				new Notice(`Failed to play ${file.name}: ${err.message}`);
			});

			this.activeAtmosphere = entry;
			this.refreshOpenViews();
		};

		if (previous) {
			if (previous.cancelFade) previous.cancelFade();

			if (this.settings.crossfadeMode === 'sequential') {
				this.activeAtmosphere = null;
				this.refreshOpenViews();
				this.fadeAudio(previous.audio, 0, this.settings.fadeOutSeconds, () => {
					previous.audio.pause();
					previous.audio.src = '';
					startIncoming();
				});
			} else {
				this.fadeAudio(previous.audio, 0, this.settings.fadeOutSeconds, () => {
					previous.audio.pause();
					previous.audio.src = '';
				});
				startIncoming();
			}
		} else {
			startIncoming();
		}
	}

	stopAtmosphere(immediate = false) {
		if (!this.activeAtmosphere) return;
		const current = this.activeAtmosphere;
		this.activeAtmosphere = null;
		this.refreshOpenViews();

		if (current.cancelFade) current.cancelFade();

		if (immediate) {
			current.audio.pause();
			current.audio.src = '';
		} else {
			this.fadeAudio(current.audio, 0, this.settings.fadeOutSeconds, () => {
				current.audio.pause();
				current.audio.src = '';
			});
		}
	}

	async playSfx(file) {
		const cfg = this.getTrackConfig(file, 'sfx');

		// If Loop is ON for this SFX, toggle it OFF instead of stacking multiple looping instances
		if (cfg.loop) {
			const existing = Array.from(this.activeSfx).filter((s) => s.path === file.path);
			if (existing.length > 0) {
				this.stopSfxByPath(file.path);
				return;
			}
		}

		const url = await this.getInstantAudioUrl(file);
		const audio = new Audio(url);
		audio.loop = cfg.loop;
		audio.volume = this.getEffectiveVolume(file, 'sfx');

		const sfxEntry = { path: file.path, file, audio };
		this.activeSfx.add(sfxEntry);
		this.refreshOpenViews();

		const cleanup = () => {
			if (!this.activeSfx.has(sfxEntry)) return;
			this.activeSfx.delete(sfxEntry);
			audio.pause();
			audio.removeAttribute('src');
			this.refreshOpenViews();
		};

		audio.addEventListener('ended', () => {
			if (!audio.loop) cleanup();
		});

		audio.play().catch((err) => {
			new Notice(`Failed to play SFX ${file.name}: ${err.message}`);
			cleanup();
		});
	}

	stopSfxByPath(filePath) {
		for (const item of Array.from(this.activeSfx)) {
			if (item.path === filePath) {
				item.audio.pause();
				item.audio.removeAttribute('src');
				this.activeSfx.delete(item);
			}
		}
		this.refreshOpenViews();
	}

	stopAllSfx() {
		for (const item of this.activeSfx) {
			item.audio.pause();
			item.audio.removeAttribute('src');
		}
		this.activeSfx.clear();
		this.refreshOpenViews();
	}

	stopAllSounds(immediate = false) {
		this.stopAtmosphere(immediate);
		this.stopAllSfx();
	}

	updateLiveVolumes() {
		if (this.activeAtmosphere && this.activeAtmosphere.audio) {
			const cfg = this.getTrackConfig(this.activeAtmosphere.file, 'atmosphere');
			this.activeAtmosphere.audio.volume = this.getEffectiveVolume(this.activeAtmosphere.file, 'atmosphere');
			this.activeAtmosphere.audio.loop = cfg.loop;
		}
		for (const item of this.activeSfx) {
			const cfg = this.getTrackConfig(item.file, 'sfx');
			item.audio.volume = this.getEffectiveVolume(item.file, 'sfx');
			item.audio.loop = cfg.loop;
		}
	}
}

class IconPickerModal extends Modal {
	constructor(app, plugin, file, category) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.category = category;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('rpg-sb-modal');

		const cfg = this.plugin.getTrackConfig(this.file, this.category);
		contentEl.createEl('h3', { text: `Icon for "${this.file.basename}"`, cls: 'rpg-sb-modal-title' });

		const grid = contentEl.createDiv({ cls: 'rpg-sb-icon-grid' });
		for (const item of TTRPG_ICONS) {
			const btn = grid.createEl('button', {
				cls: `rpg-sb-icon-choice ${cfg.icon === item.id ? 'is-selected' : ''}`,
				attr: { title: item.label, 'aria-label': item.label }
			});
			const iconHolder = btn.createSpan({ cls: 'rpg-sb-icon-choice-svg' });
			setIcon(iconHolder, item.id);
			btn.createSpan({ text: item.label, cls: 'rpg-sb-icon-choice-label' });

			btn.onclick = async () => {
				await this.plugin.setTrackOverride(this.file.path, { icon: item.id });
				this.plugin.refreshOpenViews();
				this.close();
			};
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

class SoundboardView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_SOUNDBOARD;
	}

	getDisplayText() {
		return 'Tabletop Kit - Soundboard';
	}

	getIcon() {
		return 'volume-2';
	}

	async onOpen() {
		this.render();
	}

	render() {
		const host = this.contentEl;
		const prevScroll = host.querySelector('.rpg-sb-scroll-root')?.scrollTop || 0;
		host.empty();
		host.addClass('rpg-sb-host');

		const root = host.createDiv({ cls: 'rpg-sb-scroll-root' });

		// 1. Segmented Tab Bar (All / Atmosphere / SFX)
		const tabGroup = root.createDiv({ cls: 'rpg-bs-btn-group rpg-sb-tabs' });
		const tabs = [
			{ id: 'all', label: 'All' },
			{ id: 'atmosphere', label: 'Atmosphere' },
			{ id: 'sfx', label: 'SFX' }
		];
		for (const t of tabs) {
			const btn = tabGroup.createEl('button', {
				text: t.label,
				cls: `rpg-bs-btn rpg-bs-btn-tab ${this.plugin.settings.activeTab === t.id ? 'active' : ''}`
			});
			btn.onclick = async () => {
				this.plugin.settings.activeTab = t.id;
				await this.plugin.saveData(this.plugin.settings);
				this.render();
			};
		}

		// 2. Master Volume Control Card
		const mixerCard = root.createDiv({ cls: 'rpg-bs-card rpg-sb-master-card' });
		const masterHeader = mixerCard.createDiv({ cls: 'rpg-sb-master-header' });
		masterHeader.createSpan({ text: 'Master Volume', cls: 'rpg-sb-master-title' });
		const masterPct = masterHeader.createSpan({
			text: `${Math.round(this.plugin.settings.masterVolume * 100)}%`,
			cls: 'rpg-vol-badge'
		});

		const masterSlider = mixerCard.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '1', step: '0.01' },
			cls: 'rpg-bs-range rpg-sb-master-range'
		});
		masterSlider.value = String(this.plugin.settings.masterVolume);
		masterSlider.oninput = () => {
			const val = parseFloat(masterSlider.value);
			this.plugin.settings.masterVolume = val;
			masterPct.setText(`${Math.round(val * 100)}%`);
			this.plugin.updateLiveVolumes();
			this.plugin.saveData(this.plugin.settings);
		};

		// 3. Toolbar (Tiles / List + Stop All + Refresh)
		const toolbar = root.createDiv({ cls: 'rpg-sb-toolbar' });
		const layoutGroup = toolbar.createDiv({ cls: 'rpg-bs-btn-group' });

		const tilesBtn = layoutGroup.createEl('button', {
			cls: `rpg-bs-btn rpg-bs-btn-sm ${this.plugin.settings.layoutMode === 'tiles' ? 'active' : ''}`,
			attr: { title: 'Tiles View' }
		});
		setIcon(tilesBtn, 'layout-grid');
		tilesBtn.createSpan({ text: ' Tiles' });
		tilesBtn.onclick = async () => {
			this.plugin.settings.layoutMode = 'tiles';
			await this.plugin.saveData(this.plugin.settings);
			this.render();
		};

		const listBtn = layoutGroup.createEl('button', {
			cls: `rpg-bs-btn rpg-bs-btn-sm ${this.plugin.settings.layoutMode === 'list' ? 'active' : ''}`,
			attr: { title: 'List View' }
		});
		setIcon(listBtn, 'list');
		listBtn.createSpan({ text: ' List' });
		listBtn.onclick = async () => {
			this.plugin.settings.layoutMode = 'list';
			await this.plugin.saveData(this.plugin.settings);
			this.render();
		};

		const rightActions = toolbar.createDiv({ cls: 'rpg-sb-toolbar-right' });
		const stopAllBtn = rightActions.createEl('button', {
			text: 'Stop All',
			cls: 'rpg-bs-btn rpg-bs-btn-sm rpg-bs-btn-danger'
		});
		stopAllBtn.onclick = () => this.plugin.stopAllSounds(false);

		const refreshBtn = rightActions.createEl('button', {
			cls: 'rpg-bs-btn rpg-bs-btn-sm rpg-bs-btn-icon',
			attr: { title: 'Refresh' }
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.onclick = () => this.render();

		// 4. Active Atmosphere Banner
		if (this.plugin.activeAtmosphere) {
			const banner = root.createDiv({ cls: 'rpg-bs-alert' });
			const info = banner.createDiv({ cls: 'rpg-bs-alert-info' });
			info.createSpan({ cls: 'rpg-sb-pulse-dot' });
			info.createSpan({
				text: this.plugin.activeAtmosphere.file.basename,
				cls: 'rpg-bs-alert-title'
			});
			const stopAtmBtn = banner.createEl('button', {
				text: 'Stop',
				cls: 'rpg-bs-btn rpg-bs-btn-xs rpg-bs-btn-danger'
			});
			stopAtmBtn.onclick = () => this.plugin.stopAtmosphere(false);
		}

		// 5. Category Sections
		const tab = this.plugin.settings.activeTab;
		if (tab === 'all' || tab === 'atmosphere') {
			this.renderCategory(root, 'atmosphere', 'Atmosphere', this.plugin.settings.atmosphereFolder);
		}
		if (tab === 'all' || tab === 'sfx') {
			this.renderCategory(root, 'sfx', 'SFX', this.plugin.settings.sfxFolder);
		}

		root.scrollTop = prevScroll;
	}

	renderCategory(parent, categoryKey, title, folderPath) {
		const isCollapsed = !!this.plugin.settings.collapsedSections[categoryKey];
		const files = this.plugin.getAudioFilesInFolder(folderPath);

		const card = parent.createDiv({ cls: 'rpg-bs-card rpg-sb-category' });
		const header = card.createDiv({ cls: 'rpg-sb-cat-header' });

		const titleLeft = header.createDiv({ cls: 'rpg-sb-cat-title-wrap' });
		const chev = titleLeft.createSpan({ cls: 'rpg-sb-chevron' });
		setIcon(chev, isCollapsed ? 'chevron-right' : 'chevron-down');
		titleLeft.createSpan({ text: title, cls: 'rpg-sb-cat-title' });
		titleLeft.createSpan({ text: `${files.length}`, cls: 'rpg-bs-badge' });

		header.onclick = async () => {
			this.plugin.settings.collapsedSections[categoryKey] = !isCollapsed;
			await this.plugin.saveData(this.plugin.settings);
			this.render();
		};

		if (isCollapsed) return;

		const body = card.createDiv({ cls: 'rpg-sb-cat-body' });
		if (files.length === 0) {
			body.createDiv({
				text: `No audio files found in "${folderPath}".`,
				cls: 'rpg-sb-empty'
			});
			return;
		}

		const isList = this.plugin.settings.layoutMode === 'list';
		const container = body.createDiv({
			cls: isList ? 'rpg-sb-list-wrap' : 'rpg-sb-tiles-wrap'
		});

		for (const file of files) {
			if (isList) {
				this.renderListItem(container, file, categoryKey);
			} else {
				this.renderTileItem(container, file, categoryKey);
			}
		}
	}

	getPlaybackState(file, categoryKey) {
		if (categoryKey === 'atmosphere') {
			const active = this.plugin.activeAtmosphere && this.plugin.activeAtmosphere.path === file.path;
			return { isPlaying: active, count: active ? 1 : 0 };
		}
		const count = Array.from(this.plugin.activeSfx).filter((s) => s.path === file.path).length;
		return { isPlaying: count > 0, count };
	}

	triggerTrack(file, categoryKey) {
		if (categoryKey === 'atmosphere') {
			this.plugin.playAtmosphere(file);
		} else {
			this.plugin.playSfx(file);
		}
	}

	renderTileItem(parent, file, categoryKey) {
		const cfg = this.plugin.getTrackConfig(file, categoryKey);
		const state = this.getPlaybackState(file, categoryKey);
		const label = this.plugin.settings.showFileExtensions ? file.name : file.basename;

		const tile = parent.createDiv({
			cls: `rpg-sb-tile ${state.isPlaying ? 'is-playing' : ''}`,
			attr: { title: label }
		});

		// Top Row: Action Controls on Top-Right, Centered Track Icon Below
		const topBar = tile.createDiv({ cls: 'rpg-sb-tile-top' });
		const actions = topBar.createDiv({ cls: 'rpg-sb-tile-actions' });
		actions.onclick = (e) => e.stopPropagation();

		if (categoryKey === 'sfx' && !cfg.loop && state.count > 0) {
			const countBadge = actions.createEl('button', {
				text: `×${state.count}`,
				cls: 'rpg-sb-mini-btn rpg-sb-count-btn',
				attr: { title: 'Stop active SFX instances' }
			});
			countBadge.onclick = (e) => {
				e.stopPropagation();
				this.plugin.stopSfxByPath(file.path);
			};
		}

		const loopBtn = actions.createEl('button', {
			cls: `rpg-sb-mini-btn ${cfg.loop ? 'is-loop-on' : ''}`,
			attr: { title: cfg.loop ? 'Loop: ON' : 'Loop: OFF' }
		});
		setIcon(loopBtn, 'repeat');
		loopBtn.onclick = async (e) => {
			e.stopPropagation();
			const nextLoop = !cfg.loop;
			await this.plugin.setTrackOverride(file.path, { loop: nextLoop });
			// If Loop was turned OFF while an SFX was looping, stop it cleanly
			if (categoryKey === 'sfx' && !nextLoop) {
				this.plugin.stopSfxByPath(file.path);
			}
			this.render();
		};

		const gearBtn = actions.createEl('button', {
			cls: 'rpg-sb-mini-btn',
			attr: { title: 'Choose Icon' }
		});
		setIcon(gearBtn, 'settings');
		gearBtn.onclick = (e) => {
			e.stopPropagation();
			new IconPickerModal(this.app, this.plugin, file, categoryKey).open();
		};

		const iconRow = tile.createDiv({ cls: 'rpg-sb-tile-icon-row' });
		const iconWrap = iconRow.createDiv({ cls: 'rpg-sb-tile-icon' });
		setIcon(iconWrap, cfg.icon);

		// Middle: Track Name
		const nameEl = tile.createDiv({ text: label, cls: 'rpg-sb-tile-name' });

		// Clicking anywhere on the tile body triggers playback (toggles off if SFX loop is ON)
		tile.onclick = () => this.triggerTrack(file, categoryKey);

		// Bottom: Inline Volume Slider + High-Contrast Percentage Badge
		const volRow = tile.createDiv({ cls: 'rpg-sb-tile-vol' });
		volRow.onclick = (e) => e.stopPropagation();

		const volSlider = volRow.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '1', step: '0.02' },
			cls: 'rpg-bs-range rpg-sb-inline-range'
		});
		volSlider.value = String(cfg.volume);

		const volBadge = volRow.createSpan({
			text: `${Math.round(cfg.volume * 100)}%`,
			cls: 'rpg-vol-badge rpg-vol-badge-sm'
		});

		volSlider.oninput = (e) => {
			e.stopPropagation();
			const val = parseFloat(volSlider.value);
			volBadge.setText(`${Math.round(val * 100)}%`);
			this.plugin.setTrackOverride(file.path, { volume: val });
		};
	}

	renderListItem(parent, file, categoryKey) {
		const cfg = this.plugin.getTrackConfig(file, categoryKey);
		const state = this.getPlaybackState(file, categoryKey);
		const label = this.plugin.settings.showFileExtensions ? file.name : file.basename;

		const row = parent.createDiv({
			cls: `rpg-sb-list-row ${state.isPlaying ? 'is-playing' : ''}`,
			attr: { title: label }
		});

		// Left: Playable Icon + Track Name
		const playZone = row.createDiv({ cls: 'rpg-sb-list-play' });
		const iconWrap = playZone.createDiv({ cls: 'rpg-sb-list-icon' });
		setIcon(iconWrap, cfg.icon);
		playZone.createSpan({ text: label, cls: 'rpg-sb-list-name' });
		playZone.onclick = () => this.triggerTrack(file, categoryKey);

		// Middle: Inline Volume Slider + High-Contrast Percentage
		const volZone = row.createDiv({ cls: 'rpg-sb-list-vol' });
		volZone.onclick = (e) => e.stopPropagation();

		const volSlider = volZone.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '1', step: '0.02' },
			cls: 'rpg-bs-range rpg-sb-inline-range'
		});
		volSlider.value = String(cfg.volume);

		const volBadge = volZone.createSpan({
			text: `${Math.round(cfg.volume * 100)}%`,
			cls: 'rpg-vol-badge rpg-vol-badge-sm'
		});

		volSlider.oninput = (e) => {
			e.stopPropagation();
			const val = parseFloat(volSlider.value);
			volBadge.setText(`${Math.round(val * 100)}%`);
			this.plugin.setTrackOverride(file.path, { volume: val });
		};

		// Right: True Square Loop & Settings Buttons
		const actions = row.createDiv({ cls: 'rpg-sb-list-actions' });
		actions.onclick = (e) => e.stopPropagation();

		if (categoryKey === 'sfx' && !cfg.loop && state.count > 0) {
			const countBtn = actions.createEl('button', {
				text: `×${state.count}`,
				cls: 'rpg-sb-sq-btn rpg-sb-count-btn',
				attr: { title: 'Stop active SFX instances' }
			});
			countBtn.onclick = (e) => {
				e.stopPropagation();
				this.plugin.stopSfxByPath(file.path);
			};
		}

		const loopBtn = actions.createEl('button', {
			cls: `rpg-sb-sq-btn ${cfg.loop ? 'is-loop-on' : ''}`,
			attr: { title: cfg.loop ? 'Loop: ON' : 'Loop: OFF' }
		});
		setIcon(loopBtn, 'repeat');
		loopBtn.onclick = async (e) => {
			e.stopPropagation();
			const nextLoop = !cfg.loop;
			await this.plugin.setTrackOverride(file.path, { loop: nextLoop });
			if (categoryKey === 'sfx' && !nextLoop) {
				this.plugin.stopSfxByPath(file.path);
			}
			this.render();
		};

		const gearBtn = actions.createEl('button', {
			cls: 'rpg-sb-sq-btn',
			attr: { title: 'Choose Icon' }
		});
		setIcon(gearBtn, 'settings');
		gearBtn.onclick = (e) => {
			e.stopPropagation();
			new IconPickerModal(this.app, this.plugin, file, categoryKey).open();
		};
	}
}

class SoundboardSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Tabletop Kit - Soundboard Settings' });

		const allFolders = this.app.vault.getAllLoadedFiles()
			.filter((f) => f instanceof TFolder && f.path !== '/')
			.map((f) => f.path)
			.sort();

		new Setting(containerEl)
			.setName('Atmosphere Folder Path')
			.setDesc('Vault path to your exclusive looping ambience tracks.')
			.addText((text) => text
				.setPlaceholder('Sounds/Atmosphere')
				.setValue(this.plugin.settings.atmosphereFolder)
				.onChange(async (value) => {
					this.plugin.settings.atmosphereFolder = value.trim();
					await this.plugin.saveSettings();
				}))
			.addDropdown((drop) => {
				drop.addOption('', 'Pick folder...');
				allFolders.forEach((p) => drop.addOption(p, p));
				drop.onChange(async (val) => {
					if (!val) return;
					this.plugin.settings.atmosphereFolder = val;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('SFX Folder Path')
			.setDesc('Vault path to your one-shot sound effects that layer over Atmosphere.')
			.addText((text) => text
				.setPlaceholder('Sounds/SFX')
				.setValue(this.plugin.settings.sfxFolder)
				.onChange(async (value) => {
					this.plugin.settings.sfxFolder = value.trim();
					await this.plugin.saveSettings();
				}))
			.addDropdown((drop) => {
				drop.addOption('', 'Pick folder...');
				allFolders.forEach((p) => drop.addOption(p, p));
				drop.onChange(async (val) => {
					if (!val) return;
					this.plugin.settings.sfxFolder = val;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('Fade-In Duration (seconds)')
			.setDesc('How long an incoming Atmosphere track takes to fade in.')
			.addSlider((slider) => slider
				.setLimits(0, 10, 0.5)
				.setValue(this.plugin.settings.fadeInSeconds)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.fadeInSeconds = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Fade-Out Duration (seconds)')
			.setDesc('How long an outgoing Atmosphere track takes to fade out.')
			.addSlider((slider) => slider
				.setLimits(0, 10, 0.5)
				.setValue(this.plugin.settings.fadeOutSeconds)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.fadeOutSeconds = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Crossfade Mode')
			.setDesc('Simultaneous fades both tracks at once; Sequential finishes fading out before starting the new track.')
			.addDropdown((drop) => drop
				.addOption('simultaneous', 'Simultaneous Crossfade')
				.addOption('sequential', 'Sequential (Fade Out -> Fade In)')
				.setValue(this.plugin.settings.crossfadeMode)
				.onChange(async (value) => {
					this.plugin.settings.crossfadeMode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Auto-Loop for Atmosphere')
			.setDesc('Default loop behavior for Atmosphere tracks (can be overridden per track on any tile/row).')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.autoLoopAtmosphere)
				.onChange(async (value) => {
					this.plugin.settings.autoLoopAtmosphere = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show File Extensions')
			.setDesc('Show .mp3 / .wav extensions on soundboard items.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.showFileExtensions)
				.onChange(async (value) => {
					this.plugin.settings.showFileExtensions = value;
					await this.plugin.saveSettings();
				}));
	}
}

module.exports = TabletopKitSoundboardPlugin;
