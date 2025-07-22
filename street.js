/**
 * StreetJS - A lightweight, walkable panorama viewer
 * @version 0.2.3
 * @license MIT
 * @author https://github.com/nichind/streetJS
 */
class StreetJS {
    constructor(elementId, config = {}) {
        // Default configuration
        this.config = {
            startPanorama: null,
            startDirection: 0, // degrees
            touchMultiplier: 2.5, // for touch rotation speed
            dragMultiplier: 1.5, // for mouse drag rotation speed
            language: 'auto',
            showCompass: true, // buggy
            globalNorth: 0, // % of the image width that represents north for all panoramas, can be overridden by settings of individual panoramas
            panoramas: {},
            showInfoPanel: true,
            ...config
        };

        // Internal state
        this.elementId = elementId;
        this.element = document.getElementById(elementId);
        this.currentPanoId = null;
        this.backgroundPositionX = 0;
        this.isDragging = false;
        this.startX = 0;
        this.currentWaypoints = [];
        this.edgeIndicators = { left: null, right: null };
        this.touchStartX = 0;
        this.isTransitioning = false;
        this.language = this.detectLanguage();
        this.loadedPanoramas = new Set();
        this.targetBackgroundPositionX = 0;
        this.isAnimating = false;
        this.isZoomTransitioning = false;
        this.lastNeedleRotation = 0;
        
        // Instance-specific IDs to support multiple viewers
        this.instanceId = `street-js-${Math.floor(Math.random() * 1000000)}`;
        
        // Initialize the component
        this.injectCSS();
        this.createStructure();
        this.setupEventListeners();
        
        // Load initial panorama
        if (this.config.startPanorama && this.config.panoramas[this.config.startPanorama]) {
            this.loadPanorama(this.config.startPanorama, this.config.startDirection || 0);
        } else if (Object.keys(this.config.panoramas).length > 0) {
            this.loadPanorama(Object.keys(this.config.panoramas)[0], this.config.startDirection || 0);
        } else {
            console.error('StreetJS: No panoramas defined in configuration');
            this.showError('No panoramas defined');
        }
    }

    detectLanguage() {
        if (this.config.language !== 'auto') {
            return this.config.language;
        }
        
        const userLang = navigator.language || navigator.userLanguage;
        return userLang.startsWith('ru') ? 'ru' : 'en';
    }

    getText(key) {
        const texts = {
            'instructions': {
                'en': 'Rotate to see surroundings. Click waypoints to navigate.',
                'ru': 'Вращайте для осмотра. Нажимайте на точки для перемещения камеры.'
            },
            'loading': {
                'en': 'Loading panorama...',
                'ru': 'Загрузка панорамы...'
            },
            'error': {
                'en': 'Error loading panorama',
                'ru': 'Ошибка загрузки панорамы'
            },
            'north': {
                'en': 'N',
                'ru': 'С'
            }
        };
        
        return texts[key][this.language] || texts[key]['en'];
    }

    injectCSS() {
        // Create a unique style element for this instance
        const styleId = `${this.instanceId}-style`;
        
        // Check if style already exists
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                .street-js-container {
                    width: 100%;
                    height: 100%;
                    position: relative;
                    overflow: hidden;
                    cursor: grab;
                    user-select: none;
                    background-color: #111;
                }
                
                .street-js-container:active {
                    cursor: grabbing;
                }
                
                .street-js-panorama {
                    width: 100%;
                    height: 100%;
                    background-size: auto 100%;
                    background-repeat: repeat-x;
                    position: absolute;
                    top: 0;
                    left: 0;
                    will-change: background-position, transform;
                    transition: opacity 0.6s cubic-bezier(0.23, 1, 0.32, 1);
                }
                
                .street-js-panorama.zoom-transition {
                    transition: transform 0.9s cubic-bezier(0.23, 1, 0.32, 1), 
                               background-position 0.9s cubic-bezier(0.23, 1, 0.32, 1),
                               opacity 0.4s cubic-bezier(0.23, 1, 0.32, 1);
                }

                .street-js-waypoints {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    transition: opacity 0.4s cubic-bezier(0.23, 1, 0.32, 1);
                    z-index: 2; /* Lower than overlays */
                }
                
                .street-js-waypoints.transitioning {
                    opacity: 0;
                    pointer-events: none;
                }
                
                .street-js-waypoint {
                    position: absolute;
                    transform: translate(-50%, -50%); /* Center the waypoint */
                    cursor: pointer;
                    pointer-events: all;
                    width: 50px;
                    height: 50px;
                    background-color: rgba(255, 255, 255, 0.15);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 26px;
                    border: 1px solid rgba(255, 255, 255, 0.25);
                    /* Split transitions to avoid animating position changes */
                    transition: background-color 0.3s cubic-bezier(0.23, 1, 0.32, 1),
                                border-color 0.3s cubic-bezier(0.23, 1, 0.32, 1),
                                opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1),
                                box-shadow 0.3s cubic-bezier(0.23, 1, 0.32, 1),
                                transform 0.3s cubic-bezier(0.23, 1, 0.32, 1);
                    opacity: 0;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                }
                
                .street-js-waypoint svg {
                    width: 26px;
                    height: 26px;
                    fill: rgba(255, 255, 255, 0.9);
                    transition: fill 0.3s ease;
                }
                
                .street-js-waypoint:hover {
                    transform: scale(1.1) translate(-50%, -50%);
                    background-color: rgba(255, 255, 255, 0.25);
                    border-color: rgba(255, 255, 255, 0.5);
                }
                
                .street-js-waypoint.clicked {
                    transform: scale(1.2) translate(-50%, -50%);
                    background-color: rgba(255, 255, 255, 0.4);
                    border-color: rgba(255, 255, 255, 0.7);
                    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                }

                .street-js-tooltip {
                    position: absolute;
                    bottom: 115%;
                    left: 50%;
                    transform: translateX(-50%);
                    background-color: rgba(33, 33, 33, 0.85);
                    color: white;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: 400;
                    letter-spacing: 0.3px;
                    white-space: nowrap;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.2s cubic-bezier(0.23, 1, 0.32, 1);
                    pointer-events: none;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                }
                
                .street-js-tooltip:after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    margin-left: -5px;
                    border-width: 5px;
                    border-style: solid;
                    border-color: rgba(33, 33, 33, 0.85) transparent transparent transparent;
                }
                
                .street-js-waypoint:hover .street-js-tooltip {
                    opacity: 1;
                    visibility: visible;
                    transform: translateX(-50%) translateY(-5px);
                }
                
                .street-js-edge-indicator {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 36px;
                    height: 36px;
                    background-color: rgba(255, 255, 255, 0.15);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: all;
                    cursor: pointer;
                    z-index: 10;
                    transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
                    border: 1px solid rgba(255, 255, 255, 0.25);
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
                    color: rgba(255, 255, 255, 0.9);
                    font-size: 14px;
                }
                
                .street-js-edge-indicator:hover {
                    background-color: rgba(255, 255, 255, 0.25);
                    transform: translateY(-50%) scale(1.1);
                    border-color: rgba(255, 255, 255, 0.5);
                }
                
                .street-js-edge-indicator.left {
                    left: 15px;
                }
                
                .street-js-edge-indicator.right {
                    right: 15px;
                }
                
                .street-js-edge-indicator::before {
                    content: "";
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 70%);
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    z-index: -1;
                    transform: scale(1.5);
                }
                
                .street-js-edge-indicator:hover::before {
                    opacity: 1;
                }
                
                .street-js-edge-indicator.left::after {
                    content: "◄";
                }
                
                .street-js-edge-indicator.right::after {
                    content: "►";
                }
                
                .street-js-edge-indicator .street-js-tooltip {
                    width: max-content;
                    max-width: 250px;
                    white-space: normal;
                    text-align: center;
                    line-height: 1.4;
                    padding: 8px 12px;
                    transform: translate(-50%, 0);
                    bottom: 125%;
                }
                
                .street-js-edge-indicator:hover .street-js-tooltip {
                    transform: translate(-50%, -5px);
                }
                
                .street-js-edge-indicator .street-js-tooltip-count {
                    font-weight: 600;
                    color: rgba(255, 255, 255, 0.95);
                    margin-bottom: 3px;
                }
                
                .street-js-edge-indicator .street-js-tooltip-list {
                    font-size: 11px;
                    opacity: 0.9;
                }
                
                .street-js-loading {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(17, 17, 17, 0.85);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    z-index: 20;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
                }
                
                .street-js-loading.active {
                    opacity: 1;
                    visibility: visible;
                }
                
                .street-js-spinner {
                    width: 40px;
                    height: 40px;
                    border: 2px solid rgba(255, 255, 255, 0.1);
                    border-radius: 50%;
                    border-top-color: white;
                    animation: street-js-spin 0.8s linear infinite;
                    margin-bottom: 12px;
                }
                
                @keyframes street-js-spin {
                    to { transform: rotate(360deg); }
                }
                
                .street-js-loading-text {
                    font-size: 14px;
                    font-weight: 300;
                    letter-spacing: 0.5px;
                    opacity: 0.9;
                }
                
                .street-js-instructions {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(17, 17, 17, 0.75);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    z-index: 15;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
                    text-align: center;
                }
                
                .street-js-instructions.active {
                    opacity: 1;
                    visibility: visible;
                }
                
                .street-js-instructions-icon {
                    font-size: 36px;
                    margin-bottom: 16px;
                    opacity: 0.9;
                }
                
                .street-js-instructions-text {
                    font-size: 16px;
                    max-width: 400px;
                    line-height: 1.5;
                    font-weight: 300;
                    letter-spacing: 0.3px;
                    opacity: 0.9;
                }
                
                .street-js-compass {
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    width: 45px;
                    height: 45px;
                    border-radius: 50%;
                    background-color: rgba(33, 33, 33, 0.6);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: all;
                    z-index: 5;
                    transition: opacity 0.3s, transform 0.3s;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
                    cursor: pointer;
                }
                
                .street-js-compass:hover {
                    transform: scale(1.1);
                    border-color: rgba(255, 255, 255, 0.3);
                }
                
                .street-js-compass:active {
                    transform: scale(0.95);
                    transition: transform 0.1s;
                }
                
                .street-js-compass-inner {
                    width: 70%;
                    height: 70%;
                    border-radius: 50%;
                    background-color: rgba(255, 255, 255, 0.15);
                    position: relative;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                }
                
                .street-js-compass-needle {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 1px;
                    height: 60%;
                    background: linear-gradient(to bottom, rgba(255, 76, 76, 0.9) 0%, rgba(255, 76, 76, 0.9) 50%, rgba(255, 255, 255, 0.7) 51%, rgba(255, 255, 255, 0.7) 100%);
                    transform-origin: center center;
                    transform: translate(-50%, -50%);
                    transition: transform 0.3s cubic-bezier(0.23, 1, 0.32, 1);
                }
                
                .street-js-compass-text {
                    position: absolute;
                    top: 10%;
                    left: 50%;
                    transform: translateX(-50%);
                    color: rgba(255, 255, 255, 0.9);
                    font-size: 9px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                }
                
                .street-js-error {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background-color: rgba(17, 17, 17, 0.9);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    color: white;
                    z-index: 25;
                    padding: 20px;
                    text-align: center;
                    font-weight: 300;
                    letter-spacing: 0.3px;
                }

                /* Info panel styles */
                .street-js-info-panel {
                    position: absolute;
                    left: 20px;
                    bottom: 20px;
                    min-width: 180px;
                    max-width: 320px;
                    background: rgba(24, 24, 24, 0.82);
                    color: #fff;
                    border-radius: 10px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.13);
                    padding: 14px 18px 10px 18px;
                    font-size: 15px;
                    z-index: 30;
                    font-family: inherit;
                    pointer-events: auto;
                    user-select: none;
                }
                .street-js-info-panel .sjip-title {
                    font-size: 17px;
                    font-weight: 600;
                    margin-bottom: 2px;
                    letter-spacing: 0.2px;
                }
                .street-js-info-panel .sjip-direction {
                    font-size: 13px;
                    color: #b6b6b6;
                    margin-bottom: 4px;
                }
                .street-js-info-panel .sjip-desc {
                    font-size: 13px;
                    color: #e0e0e0;
                    margin-bottom: 8px;
                }
                .street-js-info-panel .sjip-waypoints {
                    margin-top: 2px;
                    border-top: 1px solid rgba(255,255,255,0.07);
                    padding-top: 6px;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .street-js-info-panel .sjip-waypoint-btn {
                    background: none;
                    border: none;
                    color: #fff;
                    text-align: left;
                    padding: 4px 0;
                    font-size: 14px;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background 0.15s;
                    display: flex;
                    align-items: center;
                    gap: 7px;
                }
                .street-js-info-panel .sjip-waypoint-btn:hover {
                    background: rgba(255,255,255,0.08);
                }
                .street-js-info-panel .sjip-waypoint-btn svg {
                    width: 18px;
                    height: 18px;
                    opacity: 0.8;
                }
                @media (max-width: 600px) {
                    .street-js-info-panel {
                        left: 8px;
                        right: 8px;
                        bottom: 8px;
                        min-width: 0;
                        max-width: none;
                        padding: 10px 10px 8px 10px;
                        font-size: 14px;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    createStructure() {
        this.element.classList.add('street-js-container');
        this.element.innerHTML = `
            <div class="street-js-panorama"></div>
            <div class="street-js-waypoints"></div>
            <div class="street-js-loading">
                <div class="street-js-spinner"></div>
                <div class="street-js-loading-text">${this.getText('loading')}</div>
            </div>
            <div class="street-js-instructions">
                <div class="street-js-instructions-icon">👀</div>
                <div class="street-js-instructions-text">${this.getText('instructions')}</div>
            </div>
            ${this.config.showCompass ? `
                <div class="street-js-compass">
                    <div class="street-js-compass-inner">
                        <div class="street-js-compass-needle"></div>
                        <div class="street-js-compass-text">${this.getText('north')}</div>
                    </div>
                </div>
            ` : ''}
            ${this.config.showInfoPanel ? `
                <div class="street-js-info-panel" style="display:none"></div>
            ` : ''}
        `;

        // Get elements
        this.panoramaEl = this.element.querySelector('.street-js-panorama');
        this.waypointsEl = this.element.querySelector('.street-js-waypoints');
        this.loadingEl = this.element.querySelector('.street-js-loading');
        this.instructionsEl = this.element.querySelector('.street-js-instructions');
        this.compassEl = this.element.querySelector('.street-js-compass');
        this.compassNeedleEl = this.element.querySelector('.street-js-compass-needle');
        this.infoPanelEl = this.element.querySelector('.street-js-info-panel');
        
        // Show instructions initially
        setTimeout(() => {
            this.instructionsEl.classList.add('active');
        }, 1000);
    }

    setupEventListeners() {
        // Mouse events
        this.element.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.startX = e.pageX;
            this.element.style.cursor = 'grabbing';
            this.instructionsEl.classList.remove('active');
            // Stop any ongoing animation when user starts dragging
            this.isAnimating = false;
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.element.style.cursor = 'grab';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            const dx = (e.pageX - this.startX) * this.config.dragMultiplier; // Use drag multiplier for sensitivity
            this.startX = e.pageX;
            this.backgroundPositionX -= dx;
            this.updateRotation();
        });

        // Touch events
        this.element.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.touchStartX = e.touches[0].pageX;
                this.instructionsEl.classList.remove('active');
                // Stop any ongoing animation when user starts dragging
                this.isAnimating = false;
            }
        });

        this.element.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                const touchX = e.touches[0].pageX;
                const dx = (touchX - this.touchStartX) * this.config.touchMultiplier; // Use touch multiplier for sensitivity 
                this.touchStartX = touchX;
                this.backgroundPositionX -= dx;
                this.updateRotation();
            }
        });

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (!this.element.contains(document.activeElement) && document.activeElement !== this.element) {
                return;
            }
            
            const step = this.element.clientWidth / 15; // Reduced step for smoother movement
            
            if (e.key === 'ArrowLeft') {
                this.animateRotation(-step);
                this.instructionsEl.classList.remove('active');
            } else if (e.key === 'ArrowRight') {
                this.animateRotation(step);
                this.instructionsEl.classList.remove('active');
            }
        });

        // Ensure element is focusable
        this.element.tabIndex = 0;

        // Focus management for info panel
        if (this.infoPanelEl) {
            // When clicking inside the info panel, focus the main viewer
            this.infoPanelEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.element.focus();
            });
            this.infoPanelEl.addEventListener('click', (e) => {
                this.element.focus();
            });
            // Prevent blur/instructions when interacting with menu
            this.infoPanelEl.addEventListener('focus', (e) => {
                this.instructionsEl.classList.remove('active');
            });
        }

        // Handle blur/focus for instructions
        this.element.addEventListener('blur', () => {
            setTimeout(() => {
                // Only show instructions if focus is outside viewer and menu
                if (
                    !this.element.contains(document.activeElement) &&
                    (!this.infoPanelEl || !this.infoPanelEl.contains(document.activeElement))
                ) {
                    this.instructionsEl.classList.add('active');
                }
            }, 100);
        });
        
        this.element.addEventListener('focus', () => {
            this.instructionsEl.classList.remove('active');
        });

        // Add compass click event for north orientation
        if (this.compassEl) {
            this.compassEl.addEventListener('click', () => {
                this.rotateToNorth();
            });
        }
    }

    // Add method to rotate to north
    rotateToNorth() {
        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano || !pano.scaledWidth) return;

        // Get north angle (0 degrees or specified north value)
        const northOffset = pano.north !== undefined ? pano.north : this.config.globalNorth;

        // Calculate the pixel position of north (in the panorama image)
        const northPx = (northOffset / 360) * pano.scaledWidth;
        const viewWidth = this.element.clientWidth;

        // The backgroundPositionX is the left edge of the visible area in the panorama image.
        // To center north, set backgroundPositionX so that northPx is at the center of the view.
        let targetBackgroundPositionX = northPx - (viewWidth / 2);

        // Normalize to [0, pano.scaledWidth)
        targetBackgroundPositionX = (targetBackgroundPositionX % pano.scaledWidth + pano.scaledWidth) % pano.scaledWidth;

        // Find shortest rotation direction (handle wrap-around)
        let diff = targetBackgroundPositionX - this.backgroundPositionX;
        if (Math.abs(diff) > pano.scaledWidth / 2) {
            // Go the shorter way around the panorama
            if (diff > 0) {
                diff = diff - pano.scaledWidth;
            } else {
                diff = diff + pano.scaledWidth;
            }
        }

        this.animateRotation(diff);
    }

    // Animate smooth rotation
    animateRotation(step = 0) {
        if (this.isAnimating) {
            // If already animating, just update the target
            this.targetBackgroundPositionX = this.backgroundPositionX + step;
            return;
        }
        
        this.isAnimating = true;
        this.targetBackgroundPositionX = this.backgroundPositionX + step;
        
        const animate = () => {
            if (!this.isAnimating) return;
            
            // Calculate distance to target
            const diff = this.targetBackgroundPositionX - this.backgroundPositionX;
            const absDistance = Math.abs(diff);
            
            // If we're close enough, snap to target and end animation
            if (absDistance < 1) {
                this.backgroundPositionX = this.targetBackgroundPositionX;
                this.updateRotation();
                this.isAnimating = false;
                return;
            }
            
            // Move a portion of the remaining distance (easing effect)
            const moveStep = diff * 0.15;
            this.backgroundPositionX += moveStep;
            this.updateRotation();
            
            // Continue animation
            requestAnimationFrame(animate);
        };
        
        // Start animation
        requestAnimationFrame(animate);
    }

    showLoading() {
        this.loadingEl.classList.add('active');
    }

    hideLoading() {
        this.loadingEl.classList.remove('active');
    }

    showError(message) {
        const errorEl = document.createElement('div');
        errorEl.className = 'street-js-error';
        errorEl.textContent = message;
        this.element.appendChild(errorEl);
    }

    createEdgeIndicators() {
        // Remove existing indicators if they exist
        if (this.edgeIndicators.left) {
            this.edgeIndicators.left.remove();
            this.edgeIndicators.left = null;
        }
        if (this.edgeIndicators.right) {
            this.edgeIndicators.right.remove();
            this.edgeIndicators.right = null;
        }

        // Create left indicator
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'street-js-edge-indicator left';
        leftIndicator.style.display = 'none';
        leftIndicator.addEventListener('click', () => {
            this.backgroundPositionX -= this.element.clientWidth / 2;
            this.updateRotation();
        });
        this.waypointsEl.appendChild(leftIndicator);
        this.edgeIndicators.left = leftIndicator;

        // Create right indicator
        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'street-js-edge-indicator right';
        rightIndicator.style.display = 'none';
        rightIndicator.addEventListener('click', () => {
            this.backgroundPositionX += this.element.clientWidth / 2;
            this.updateRotation();
        });
        this.waypointsEl.appendChild(rightIndicator);
        this.edgeIndicators.right = rightIndicator;
    }

    updateRotation() {
        if (!this.currentPanoId) return;
        
        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano || !pano.scaledWidth) return;

        this.backgroundPositionX = (this.backgroundPositionX % pano.scaledWidth + pano.scaledWidth) % pano.scaledWidth;
        this.panoramaEl.style.backgroundPositionX = `-${this.backgroundPositionX}px`;
        this.updateWaypoints();
        this.updateCompass();
        this.updateInfoPanel(); // <--- update info panel on rotation
    }

    updateCompass() {
        if (!this.compassEl || !this.compassNeedleEl) return;

        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano || !pano.scaledWidth) return;

        // Calculate the center of the view in panorama coordinates
        const viewWidth = this.element.clientWidth;
        const centerPx = (this.backgroundPositionX + viewWidth / 2) % pano.scaledWidth;
        // Calculate the current angle based on the center of the view
        let angle = (centerPx / pano.scaledWidth) * 360;

        // Apply panorama-specific north or global north
        const northOffset = pano.north !== undefined ? pano.north : this.config.globalNorth;

        // Calculate rotation for the compass needle
        let needleRotation = angle + northOffset;

        // Normalize the needle rotation to prevent sudden jumps
        while (needleRotation < 0) needleRotation += 360;
        while (needleRotation >= 360) needleRotation -= 360;

        // Determine the shortest path to the new rotation
        let clockwiseDiff = (needleRotation - this.lastNeedleRotation + 360) % 360;
        let counterClockwiseDiff = (this.lastNeedleRotation - needleRotation + 360) % 360;

        if (clockwiseDiff <= counterClockwiseDiff) {
            needleRotation = this.lastNeedleRotation + clockwiseDiff;
        } else {
            needleRotation = this.lastNeedleRotation - counterClockwiseDiff;
        }

        this.lastNeedleRotation = needleRotation;
        this.compassNeedleEl.style.transform = `translate(-50%, -50%) rotate(${needleRotation}deg)`;
        this.compassEl.style.cursor = 'pointer';
    }

    updateWaypoints() {
        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano || !pano.scaledWidth) return;

        const viewWidth = this.element.clientWidth;

        // Reset edge indicators
        let hasLeftWaypoints = false;
        let hasRightWaypoints = false;
        let leftWaypointNames = [];
        let rightWaypointNames = [];

        this.currentWaypoints.forEach(waypoint => {
            const waypointData = waypoint.data;
            const waypointCenterPx = (waypointData.fromPx + waypointData.toPx) / 2;

            // Calculate the visual position based on rotation
            const primaryPosition = waypointCenterPx - this.backgroundPositionX;
            
            // Check if waypoint should be visible in any of its possible positions
            // (original, shifted right by panorama width, shifted left by panorama width)
            const positions = [
                primaryPosition,
                primaryPosition + pano.scaledWidth,
                primaryPosition - pano.scaledWidth
            ];

            // Find the best position for the waypoint
            let bestPosition = null;
            let bestDistance = Infinity;
            
            for (const pos of positions) {
                if (pos >= -50 && pos < viewWidth + 50) { // Slightly extend visibility beyond edges
                    const distance = Math.abs(pos - viewWidth / 2); // Distance from center of view
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestPosition = pos;
                    }
                }
            }

            if (bestPosition !== null) {
                // Waypoint is visible - update position without transition
                waypoint.element.style.left = `${bestPosition}px`;
                
                // Apply vertical position based on height parameter
                if (waypointData.height !== undefined) {
                    waypoint.element.style.top = `${waypointData.height}%`;
                } else {
                    waypoint.element.style.top = '50%'; // Default to middle if not specified
                }
                
                // Make waypoint visible with proper opacity transition (but not position)
                if (waypoint.element.style.display === 'none') {
                    waypoint.element.style.opacity = '0';
                    waypoint.element.style.display = 'flex';
                    // Use setTimeout to ensure the display change has taken effect before starting the opacity transition
                    setTimeout(() => {
                        waypoint.element.style.opacity = '1';
                    }, 10);
                } else {
                    waypoint.element.style.opacity = '1';
                }
                
                // Adjust waypoint z-index based on distance from center for 3D effect
                const zIndex = Math.round(100 - bestDistance / 10);
                waypoint.element.style.zIndex = Math.max(1, zIndex);
                
                // Remove any transform scale that was previously applied
                // Just keep the centering translation with scale if specified
                const baseTransform = 'translate(-50%, -50%)';
                const scale = waypoint.data.scale !== undefined ? waypoint.data.scale : 1;
                waypoint.element.style.transform = scale !== 1 ? `${baseTransform} scale(${scale})` : baseTransform;
            } else {
                // Waypoint is not visible
                waypoint.element.style.opacity = '0';
                // Use setTimeout to hide after fade out
                setTimeout(() => {
                    if (parseFloat(waypoint.element.style.opacity) === 0) {
                        waypoint.element.style.display = 'none';
                    }
                }, 300);
                
                // Determine if it's to the left or right for edge indicators
                let direction = null;
                for (const pos of positions) {
                    if (pos < 0) {
                        direction = 'left';
                        hasLeftWaypoints = true;
                        if (this.config.panoramas[waypointData.to]) {
                            leftWaypointNames.push({
                                name: waypointData.label || this.config.panoramas[waypointData.to].name,
                                distance: Math.abs(pos)
                            });
                        }
                        break;
                    } else if (pos >= viewWidth) {
                        direction = 'right';
                        hasRightWaypoints = true;
                        if (this.config.panoramas[waypointData.to]) {
                            rightWaypointNames.push({
                                name: waypointData.label || this.config.panoramas[waypointData.to].name,
                                distance: Math.abs(pos - viewWidth)
                            });
                        }
                        break;
                    }
                }
            }
        });

        // Update edge indicators with enhanced information
        this.updateEdgeIndicator(this.edgeIndicators.left, hasLeftWaypoints, leftWaypointNames, 'left');
        this.updateEdgeIndicator(this.edgeIndicators.right, hasRightWaypoints, rightWaypointNames, 'right');
    }

    updateEdgeIndicator(indicator, hasWaypoints, waypointsList, direction) {
        if (!indicator) return;
        
        indicator.style.display = hasWaypoints ? 'flex' : 'none';
        
        if (hasWaypoints && waypointsList.length > 0) {
            // Update or create enhanced tooltip for the indicator
            let tooltip = indicator.querySelector('.street-js-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'street-js-tooltip';
                indicator.appendChild(tooltip);
            }
            
            // Sort waypoints by distance (closest first)
            waypointsList.sort((a, b) => a.distance - b.distance);
            
            // Create enhanced tooltip content with count and list
            const tooltipContent = `
                <div class="street-js-tooltip-count">
                    ${waypointsList.length} ${waypointsList.length === 1 ? 'location' : 'locations'} ${direction === 'left' ? 'to the left' : 'to the right'}
                </div>
                <div class="street-js-tooltip-list">
                    ${waypointsList.map(wp => wp.name).join(' • ')}
                </div>
            `;
            
            tooltip.innerHTML = tooltipContent;
            
            // Add pulse animation for the edge indicator to draw attention
            indicator.classList.add('pulse');
        }
    }

    loadPanorama(panoId, initialAngle = null, fromWaypoint = null) {
        if (this.isTransitioning || this.isZoomTransitioning) return;
        
        // If already loaded, just update the angle
        if (this.currentPanoId === panoId && initialAngle !== null && !fromWaypoint) {
            const panoData = this.config.panoramas[panoId];
            if (panoData && panoData.scaledWidth) {
                const viewWidth = this.element.clientWidth;
                const centerPx = (initialAngle / 360) * panoData.scaledWidth;
                this.backgroundPositionX = centerPx - (viewWidth / 2);
                this.updateRotation();
            }
            return;
        }
        
        // If transitioning from a waypoint, start zoom animation
        if (fromWaypoint) {
            this.startZoomTransition(panoId, initialAngle, fromWaypoint);
            return;
        }
        
        // Check if panorama is already loaded to skip loading screen
        const isPreloaded = this.loadedPanoramas.has(panoId);
        
        if (!isPreloaded) {
            this.showLoading();
        }
        
        this.isTransitioning = true;
        
        // Fade out current panorama if exists
        if (this.currentPanoId) {
            this.panoramaEl.style.opacity = '0';
            setTimeout(() => this.loadNewPanorama(panoId, initialAngle, isPreloaded), 500);
        } else {
            this.loadNewPanorama(panoId, initialAngle, isPreloaded);
        }
    }

    startZoomTransition(targetPanoId, initialAngle, waypointData) {
        this.isZoomTransitioning = true;
        
        // Add clicked class to waypoint for immediate feedback
        const clickedWaypoint = this.currentWaypoints.find(wp => wp.data.to === targetPanoId);
        if (clickedWaypoint) {
            clickedWaypoint.element.classList.add('clicked');
        }
        
        // Hide waypoints during transition
        this.waypointsEl.classList.add('transitioning');
        
        // Calculate zoom target position
        const waypointCenterPx = (waypointData.fromPx + waypointData.toPx) / 2;
        const viewWidth = this.element.clientWidth;
        const viewHeight = this.element.clientHeight;
        
        // Calculate the position where the waypoint should be centered
        const targetBackgroundX = waypointCenterPx - (viewWidth / 2);
        
        // Add zoom transition class
        this.panoramaEl.classList.add('zoom-transition');
        
        // First, smoothly rotate to center the waypoint
        this.backgroundPositionX = targetBackgroundX;
        this.panoramaEl.style.backgroundPositionX = `-${this.backgroundPositionX}px`;
        
        // Then zoom in with a slight delay
        setTimeout(() => {
            // Calculate zoom scale and translation
            const zoomScale = 2.5;
            const waypointViewX = waypointCenterPx - this.backgroundPositionX;
            const waypointViewY = (waypointData.height || 50) * viewHeight / 100;
            
            // Calculate translation to keep waypoint centered during zoom
            const translateX = (viewWidth / 2 - waypointViewX) * (zoomScale - 1) / zoomScale;
            const translateY = (viewHeight / 2 - waypointViewY) * (zoomScale - 1) / zoomScale;
            
            // Apply zoom transformation
            this.panoramaEl.style.transform = `scale(${zoomScale}) translate(${translateX}px, ${translateY}px)`;
            
            // Start fading out after zoom begins
            setTimeout(() => {
                this.panoramaEl.style.opacity = '0';
                
                // Load new panorama after fade out
                setTimeout(() => {
                    this.loadNewPanoramaWithZoom(targetPanoId, initialAngle);
                }, 300);
            }, 400);
        }, 100);
    }
    
    loadNewPanoramaWithZoom(panoId, initialAngle) {
        // Check if panorama is already loaded
        const isPreloaded = this.loadedPanoramas.has(panoId);
        
        if (!isPreloaded) {
            this.showLoading();
        }
        
        this.currentPanoId = panoId;
        const panoData = this.config.panoramas[panoId];
        
        // Clear current waypoints
        this.waypointsEl.innerHTML = '';
        this.currentWaypoints = [];
        
        // Create edge indicators
        this.createEdgeIndicators();
        
        const img = new Image();
        img.onload = () => {
            const originalWidth = panoData.width;
            const originalHeight = (img.height / img.width) * originalWidth;

            const containerHeight = this.element.clientHeight;
            const scaledWidth = (containerHeight / originalHeight) * originalWidth;
            panoData.scaledWidth = scaledWidth;

            // Reset transform and prepare for new panorama
            this.panoramaEl.style.transform = 'scale(1.2)'; // Start slightly zoomed
            this.panoramaEl.style.backgroundImage = `url('${panoData.url}')`;

            if (initialAngle !== null) {
                const viewWidth = this.element.clientWidth;
                const centerPx = (initialAngle / 360) * scaledWidth;
                this.backgroundPositionX = centerPx - (viewWidth / 2);
            } else {
                this.backgroundPositionX = 0;
            }
            
            this.panoramaEl.style.backgroundPositionX = `-${this.backgroundPositionX}px`;

            // Fade in new panorama and zoom out to normal scale
            setTimeout(() => {
                this.panoramaEl.style.opacity = '1';
                this.panoramaEl.style.transform = 'scale(1)';
                
                // Remove transition class and show waypoints after animation
                setTimeout(() => {
                    this.panoramaEl.classList.remove('zoom-transition');
                    this.waypointsEl.classList.remove('transitioning');
                    this.isZoomTransitioning = false;
                    this.isTransitioning = false;
                }, 800);
            }, 50);

            // Create waypoints
            if (panoData.waypoints) {
                const scaleRatio = scaledWidth / originalWidth;
                panoData.waypoints.forEach(waypoint => {
                    const waypointEl = document.createElement('div');
                    waypointEl.className = 'street-js-waypoint';

                    // Add icon
                    if (waypoint.icon) {
                        if (typeof waypoint.icon === 'string' && this.getBuiltInIcon(waypoint.icon)) {
                            waypointEl.innerHTML = this.getBuiltInIcon(waypoint.icon);
                        } else {
                            waypointEl.innerHTML = `<img src="${waypoint.icon}" alt="Waypoint">`;
                        }
                    } else {
                        waypointEl.innerHTML = this.getBuiltInIcon('waypoint');
                    }

                    // Add tooltip
                    const tooltip = document.createElement('div');
                    tooltip.className = 'street-js-tooltip';
                    
                    const labelText = waypoint.label || 
                        (this.config.panoramas[waypoint.to] ? 
                            this.config.panoramas[waypoint.to].name : 
                            waypoint.to);
                            
                    tooltip.textContent = labelText;
                    waypointEl.appendChild(tooltip);

                    const scaledWaypoint = {
                        to: waypoint.to,
                        fromPx: waypoint.fromPx * scaleRatio,
                        toPx: waypoint.toPx * scaleRatio,
                        height: waypoint.height !== undefined ? waypoint.height : 50,
                        direction: waypoint.direction,
                        scale: waypoint.scale !== undefined ? Math.max(0.1, Math.min(10, waypoint.scale)) : 1
                    };

                    // Apply custom scale if specified
                    if (scaledWaypoint.scale !== 1) {
                        waypointEl.style.transform = `translate(-50%, -50%) scale(${scaledWaypoint.scale})`;
                    }

                    waypointEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        
                        if (this.isZoomTransitioning || this.isTransitioning) return;
                        
                        if (waypoint.direction !== undefined) {
                            const forcedAngle = (waypoint.direction / 100) * 360;
                            this.loadPanorama(waypoint.to, forcedAngle, scaledWaypoint);
                        } else {
                            const currentPano = this.config.panoramas[this.currentPanoId];
                            const viewWidth = this.element.clientWidth;
                            const centerPx = this.backgroundPositionX + viewWidth / 2;
                            const angle = (centerPx / currentPano.scaledWidth) * 360;
                            this.loadPanorama(waypoint.to, angle, scaledWaypoint);
                        }
                    });

                    this.waypointsEl.appendChild(waypointEl);
                    this.currentWaypoints.push({ element: waypointEl, data: scaledWaypoint });
                });
            }

            // Mark as loaded
            this.loadedPanoramas.add(panoId);
            
            this.updateRotation();
            this.hideLoading();
            this.updateInfoPanel(); // <--- update info panel on panorama load
        };
        
        img.onerror = () => {
            console.error(`StreetJS: Failed to load panorama: ${panoData.url}`);
            this.showError(this.getText('error'));
            this.hideLoading();
            this.isZoomTransitioning = false;
            this.isTransitioning = false;
            this.panoramaEl.classList.remove('zoom-transition');
            this.waypointsEl.classList.remove('transitioning');
        };
        
        img.src = panoData.url;
    }
    
    loadNewPanorama(panoId, initialAngle, isPreloaded = false) {
        this.currentPanoId = panoId;
        const panoData = this.config.panoramas[panoId];
        
        // Clear current waypoints
        this.waypointsEl.innerHTML = '';
        this.currentWaypoints = [];
        
        // Create edge indicators
        this.createEdgeIndicators();
        
        const img = new Image();
        img.onload = () => {
            const originalWidth = panoData.width;
            const originalHeight = (img.height / img.width) * originalWidth;

            const containerHeight = this.element.clientHeight;
            const scaledWidth = (containerHeight / originalHeight) * originalWidth;
            panoData.scaledWidth = scaledWidth;

            this.panoramaEl.style.backgroundImage = `url('${panoData.url}')`;
            this.panoramaEl.style.opacity = '1';

            if (initialAngle !== null) {
                const viewWidth = this.element.clientWidth;
                const centerPx = (initialAngle / 360) * scaledWidth;
                this.backgroundPositionX = centerPx - (viewWidth / 2);
            } else {
                this.backgroundPositionX = 0;
            }

            if (panoData.waypoints) {
                const scaleRatio = scaledWidth / originalWidth;
                panoData.waypoints.forEach(waypoint => {
                    const waypointEl = document.createElement('div');
                    waypointEl.className = 'street-js-waypoint';

                    // Add icon
                    if (waypoint.icon) {
                        if (typeof waypoint.icon === 'string' && this.getBuiltInIcon(waypoint.icon)) {
                            waypointEl.innerHTML = this.getBuiltInIcon(waypoint.icon);
                        } else {
                            waypointEl.innerHTML = `<img src="${waypoint.icon}" alt="Waypoint">`;
                        }
                    } else {
                        waypointEl.innerHTML = this.getBuiltInIcon('waypoint');
                    }

                    // Add tooltip
                    const tooltip = document.createElement('div');
                    tooltip.className = 'street-js-tooltip';
                    
                    const labelText = waypoint.label || 
                        (this.config.panoramas[waypoint.to] ? 
                            this.config.panoramas[waypoint.to].name : 
                            waypoint.to);
                            
                    tooltip.textContent = labelText;
                    waypointEl.appendChild(tooltip);

                    const scaledWaypoint = {
                        to: waypoint.to,
                        fromPx: waypoint.fromPx * scaleRatio,
                        toPx: waypoint.toPx * scaleRatio,
                        height: waypoint.height !== undefined ? waypoint.height : 50,
                        direction: waypoint.direction,
                        scale: waypoint.scale !== undefined ? Math.max(0.1, Math.min(10, waypoint.scale)) : 1
                    };

                    // Apply custom scale if specified
                    if (scaledWaypoint.scale !== 1) {
                        waypointEl.style.transform = `translate(-50%, -50%) scale(${scaledWaypoint.scale})`;
                    }

                    waypointEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        
                        if (this.isZoomTransitioning || this.isTransitioning) return;
                        
                        if (waypoint.direction !== undefined) {
                            const forcedAngle = (waypoint.direction / 100) * 360;
                            this.loadPanorama(waypoint.to, forcedAngle, scaledWaypoint);
                        } else {
                            const currentPano = this.config.panoramas[this.currentPanoId];
                            const viewWidth = this.element.clientWidth;
                            const centerPx = this.backgroundPositionX + viewWidth / 2;
                            const angle = (centerPx / currentPano.scaledWidth) * 360;
                            this.loadPanorama(waypoint.to, angle, scaledWaypoint);
                        }
                    });

                    this.waypointsEl.appendChild(waypointEl);
                    this.currentWaypoints.push({ element: waypointEl, data: scaledWaypoint });
                });
            }

            // Mark as loaded for future transitions
            this.loadedPanoramas.add(panoId);
            
            this.updateRotation();
            this.hideLoading();
            this.isTransitioning = false;
            this.updateInfoPanel(); // <--- update info panel on panorama load
        };
        
        img.onerror = () => {
            console.error(`StreetJS: Failed to load panorama: ${panoData.url}`);
            this.showError(this.getText('error'));
            this.hideLoading();
            this.isTransitioning = false;
        };
        
        // If preloaded, set src from cache, otherwise load from URL
        if (isPreloaded) {
            img.src = panoData.url;
            // For preloaded images, we can often trigger onload immediately 
            // by setting a timeout as the browser might have the image cached
            setTimeout(() => {
                if (img.complete) {
                    img.onload();
                }
            }, 50);
        } else {
            img.src = panoData.url;
        }
    }

    getBuiltInIcon(iconName) {
        const icons = {
            waypoint: `<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="white"/></svg>`,
            door: `<svg viewBox="0 0 24 24"><path d="M19 19V5c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v14H3v2h18v-2h-2zm-2 0H7V5h10v14zm-4-8h2v2h-2v-2z" fill="white"/></svg>`,
            stairsUp: `<svg viewBox="0 0 24 24"><path d="M11 20V7.825L5.4 13.425L4 12L12 4L20 12L18.6 13.425L13 7.825V20H11Z" fill="white"/></svg>`,
            stairsDown: `<svg viewBox="0 0 24 24"><path d="M11 4V16.175L5.4 10.575L4 12L12 20L20 12L18.6 10.575L13 16.175V4H11Z" fill="white"/></svg>`,
            info: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="white"/></svg>`,
            point: `<svg viewBox="0 0 24 24"><path d="M12 15C12.8333 15 13.5417 14.7083 14.125 14.125C14.7083 13.5417 15 12.8333 15 12C15 11.1667 14.7083 10.4583 14.125 9.875C13.5417 9.29167 12.8333 9 12 9C11.1667 9 10.4583 9.29167 9.875 9.875C9.29167 10.4583 9 11.1667 9 12C9 12.8333 9.29167 13.5417 9.875 14.125C10.4583 14.7083 11.1667 15 12 15ZM12 22C10.6167 22 9.31667 21.7375 8.1 21.2125C6.88333 20.6875 5.825 19.975 4.925 19.075C4.025 18.175 3.3125 17.1167 2.7875 15.9C2.2625 14.6833 2 13.3833 2 12C2 10.6167 2.2625 9.31667 2.7875 8.1C3.3125 6.88333 4.025 5.825 4.925 4.925C5.825 4.025 6.88333 3.3125 8.1 2.7875C9.31667 2.2625 10.6167 2 12 2C13.3833 2 14.6833 2.2625 15.9 2.7875C17.1167 3.3125 18.175 4.025 19.075 4.925C19.975 5.825 20.6875 6.88333 21.2125 8.1C21.7375 9.31667 22 10.6167 22 12C22 13.3833 21.7375 14.6833 21.2125 15.9C20.6875 17.1167 19.975 18.175 19.075 19.075C18.175 19.975 17.1167 20.6875 15.9 21.2125C14.6833 21.7375 13.3833 22 12 22ZM12 20C14.2333 20 16.125 19.225 17.675 17.675C19.225 16.125 20 14.2333 20 12C20 9.76667 19.225 7.875 17.675 6.325C16.125 4.775 14.2333 4 12 4C9.76667 4 7.875 4.775 6.325 6.325C4.775 7.875 4 9.76667 4 12C4 14.2333 4.775 16.125 6.325 17.675C7.875 19.225 9.76667 20 12 20Z" fill="white"/></svg>`,
            arrowLeft: '<svg viewBox="0 0 24 24"><path d="M17.5873 19.9919V9.99194H8.41228L12.0123 13.5919L10.6123 15.0169L4.58728 8.99194L10.5873 2.99194L12.0123 4.41694L8.41228 7.99194H19.5873V19.9919H17.5873Z" fill="white"/></svg>',
            arrowRight: '<svg viewBox="0 0 24 24"><path d="M7.58728 19.9919V9.99194H16.7623L13.1623 13.5919L14.5623 15.0169L20.5873 8.99194L14.5873 2.99194L13.1623 4.41694L16.7623 7.99194H5.58728V19.9919H7.58728Z" fill="white"/></svg>',
        };
        
        return icons[iconName] || icons.waypoint;
    }

    updateInfoPanel() {
        if (!this.config.showInfoPanel || !this.infoPanelEl) return;
        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano) {
            this.infoPanelEl.style.display = 'none';
            return;
        }
        // Show panel
        this.infoPanelEl.style.display = 'block';

        // Get general direction
        const dir = this.getGeneralDirection();

        // Description
        const desc = pano.description ? `<div class="sjip-desc">${pano.description}</div>` : '';

        // Waypoints menu
        let waypointsHtml = '';
        if (pano.waypoints && pano.waypoints.length > 0) {
            waypointsHtml = `<div class="sjip-waypoints">` +
                pano.waypoints.map(wp => {
                    const target = this.config.panoramas[wp.to];
                    const label = wp.label || (target ? target.name : wp.to);
                    const icon = this.getBuiltInIcon(wp.icon || 'waypoint');
                    return `<button class="sjip-waypoint-btn" data-to="${wp.to}">${icon}<span>${label}</span></button>`;
                }).join('') +
                `</div>`;
        }

        this.infoPanelEl.innerHTML = `
            <div class="sjip-title">${pano.name || ''}</div>
            <div class="sjip-direction">${dir}</div>
            ${desc}
            ${waypointsHtml}
        `;

        // --- Menu waypoint hover/leave logic ---
        if (pano.waypoints && pano.waypoints.length > 0) {
            const menuBtns = this.infoPanelEl.querySelectorAll('.sjip-waypoint-btn');
            menuBtns.forEach(btn => {
                const to = btn.getAttribute('data-to');
                // Find the waypoint data for direction/height if needed
                const wp = pano.waypoints.find(w => w.to === to);

                // Highlight corresponding waypoint on hover
                btn.onmouseenter = () => {
                    // Find the corresponding waypoint element
                    const wpObj = this.currentWaypoints.find(w => w.data.to === to);
                    if (wpObj) {
                        wpObj.element.classList.add('menu-highlight');
                        // Rotate camera to center this waypoint
                        this.rotateToWaypoint(wpObj.data);
                    }
                    // Keep viewer focused
                    this.element.focus();
                };
                btn.onmouseleave = () => {
                    const wpObj = this.currentWaypoints.find(w => w.data.to === to);
                    if (wpObj) {
                        wpObj.element.classList.remove('menu-highlight');
                    }
                };
                btn.onmousedown = (e) => {
                    // Prevent blur when clicking
                    e.preventDefault();
                    this.element.focus();
                };
                btn.onclick = (e) => {
                    if (wp) {
                        if (wp.direction !== undefined) {
                            const forcedAngle = (wp.direction / 100) * 360;
                            this.loadPanorama(wp.to, forcedAngle, wp);
                        } else {
                            // Use current center angle
                            const viewWidth = this.element.clientWidth;
                            const centerPx = this.backgroundPositionX + viewWidth / 2;
                            const angle = (centerPx / pano.scaledWidth) * 360;
                            this.loadPanorama(wp.to, angle, wp);
                        }
                    }
                };
            });
        }
    }

    rotateToWaypoint(waypointData) {
        // Smoothly rotate the panorama to center the waypoint
        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano || !pano.scaledWidth) return;
        const viewWidth = this.element.clientWidth;
        const waypointCenterPx = (waypointData.fromPx + waypointData.toPx) / 2;
        const targetPosition = waypointCenterPx - (viewWidth / 2);
        const moveStep = targetPosition - this.backgroundPositionX;
        this.animateRotation(moveStep);
    }

    getGeneralDirection() {
        // Returns a string like "North", "East", etc. based on the center of the view
        const pano = this.config.panoramas[this.currentPanoId];
        if (!pano || !pano.scaledWidth) return '';
        // Calculate current angle (0 = north) at the center of the view
        const viewWidth = this.element.clientWidth;
        const centerPx = (this.backgroundPositionX + viewWidth / 2) % pano.scaledWidth;
        let angle = (centerPx / pano.scaledWidth) * 360;
        const northOffset = pano.north !== undefined ? pano.north : this.config.globalNorth;
        angle = (angle + northOffset) % 360;
        if (angle < 0) angle += 360;
        // 8 directions
        const dirs = [
            { name: {en:'North',ru:'Север'}, deg: 0 },
            { name: {en:'North-East',ru:'Северо-восток'}, deg: 45 },
            { name: {en:'East',ru:'Восток'}, deg: 90 },
            { name: {en:'South-East',ru:'Юго-восток'}, deg: 135 },
            { name: {en:'South',ru:'Юг'}, deg: 180 },
            { name: {en:'South-West',ru:'Юго-запад'}, deg: 225 },
            { name: {en:'West',ru:'Запад'}, deg: 270 },
            { name: {en:'North-West',ru:'Северо-запад'}, deg: 315 }
        ];
        let idx = Math.round(angle / 45) % 8;
        const lang = this.language === 'ru' ? 'ru' : 'en';
        return dirs[idx].name[lang];
    }
}

// Export as global or module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StreetJS;
} else {
    window.StreetJS = StreetJS;
}
