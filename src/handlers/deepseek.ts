import { TokenHandler } from "../core/types";
import { fromPreTrained } from "../tokenizers/deepseek";

const BUTTON_ID = "deepseek-token-counter";
const DEBUG_LOG = false;

export class DeepSeekHandler implements TokenHandler {
    private tokenizer: any = null;
    private containerEl: HTMLElement | null = null;
    private labelSpan: HTMLSpanElement | null = null;
    private timer: number | null = null;
    private lastRun = 0;
    private mo: MutationObserver | null = null;
    private observeTargets: Node[] = [];
    private urlCheckTimer: number | null = null;
    private lastHref = location.href;
    private cachedButtonWidth = 0;
    private uploadButtonRef: HTMLElement | null = null;

    async init() {
        try {
            // Pre-load tokenizer using fromPreTrained pattern
            this.tokenizer = await fromPreTrained();
        } catch (e) {
            console.error("[DeepSeekToken] Failed to load tokenizer:", e);
        }

        this.updateObserverTarget();
        this.scheduleCompute(0);

        this.urlCheckTimer = window.setInterval(() => {
            const href = location.href;
            if (href !== this.lastHref) {
                this.lastHref = href;
                this.onUrlChange();
            }
        }, 500);
    }

    destroy() {
        if (this.urlCheckTimer) clearInterval(this.urlCheckTimer);
        if (this.mo) this.mo.disconnect();
        document.getElementById(BUTTON_ID)?.remove();
    }

    private getTextsFromPage(): string[] {
        const texts: string[] = [];

        if (DEBUG_LOG) {
            console.log('[DeepSeekToken] === Starting text extraction ===');
        }

        // DeepSeek main chat area uses class: _0f72b0b ds-scroll-area
        // Sidebar uses: _6d215eb ds-scroll-area
        const scrollArea = document.querySelector('._0f72b0b.ds-scroll-area');

        if (DEBUG_LOG) {
            console.log('[DeepSeekToken] Main chat scroll area found:', !!scrollArea);
            if (scrollArea) {
                console.log('[DeepSeekToken] Scroll area class:', scrollArea.className);
                console.log('[DeepSeekToken] Scroll area children count:', scrollArea.children.length);
            }
        }

        if (scrollArea) {
            // Inside the main scroll area, conversation content is in .dad65929 elements
            const conversationContainers = scrollArea.querySelectorAll('.dad65929');

            if (DEBUG_LOG) {
                console.log('[DeepSeekToken] Conversation containers (.dad65929) found:', conversationContainers.length);
            }

            conversationContainers.forEach((container, index) => {
                const text = (container.textContent || "").trim();
                if (text) {
                    texts.push(text);
                    if (DEBUG_LOG) {
                        console.log(`[DeepSeekToken] Conversation ${index + 1} (${text.length} chars):`, text.substring(0, 100) + (text.length > 100 ? '...' : ''));
                    }
                }
            });
        }

        // Get input area content (DeepSeek uses textarea with specific placeholder)
        const inputArea = document.querySelector('textarea[placeholder*="DeepSeek"], textarea');
        if (inputArea) {
            const inputText = (inputArea.textContent || (inputArea as HTMLTextAreaElement).value || "").trim();
            if (inputText) {
                texts.push(inputText);
                if (DEBUG_LOG) {
                    console.log('[DeepSeekToken] Input area text:', inputText);
                }
            }
        }

        if (DEBUG_LOG) {
            console.log('[DeepSeekToken] Total texts extracted:', texts.length);
            console.log('[DeepSeekToken] Total characters:', texts.join('').length);
        }

        return texts.filter(Boolean);
    }

    private ensureUiMounted() {
        // Find the upload button as reference for positioning
        const uploadButton = document.querySelector('._57370c5._5dedc1e.ds-icon-button') as HTMLElement;

        if (!uploadButton) {
            return;
        }

        // Check if our button already exists
        let existing = document.getElementById(BUTTON_ID);
        if (existing) {
            this.containerEl = existing as HTMLElement;
            this.labelSpan = existing.querySelector(".token-label");
            this.uploadButtonRef = uploadButton;
            // Update position and recalculate width
            this.updateButtonPosition();
            return;
        }

        // Create button matching DeepSeek's style
        const button = document.createElement("div");
        button.id = BUTTON_ID;
        // Remove ds-icon-button--sizing-container to avoid fixed circular size
        button.className = "_57370c5 _5dedc1e ds-icon-button ds-icon-button--l";
        button.setAttribute("tabindex", "0");
        button.setAttribute("role", "button");
        button.setAttribute("aria-disabled", "false");

        // Position to the left of upload button (will be updated after measuring width)
        button.style.position = 'fixed';
        button.style.zIndex = '1000';
        // Use !important to override DeepSeek's circular button styles
        button.style.cssText += 'border-radius: 20px !important; overflow: hidden !important; width: auto !important; height: 34px !important; min-width: fit-content !important; max-width: max-content !important; display: inline-flex !important; align-items: center !important;';

        // Add custom hover background for pill shape (not circular)
        const hoverBg = document.createElement("div");
        hoverBg.className = "ds-text-button__hover-bg";
        hoverBg.style.cssText = `
            width: 100%;
            height: 100%;
            z-index: 0;
            background-color: transparent;
            border-radius: 20px;
            transition: background-color 0.2s;
            position: absolute;
            top: 0;
            left: 0;
        `;

        // Create label for token count
        const label = document.createElement("div");
        label.className = "token-label";
        label.style.cssText = `
            padding: 0 12px;
            font-size: 14px;
            font-weight: 500;
            white-space: nowrap;
            color: var(--ds-gray-900, #1f2329);
            position: relative;
            z-index: 1;
        `;
        label.textContent = "0 tokens";
        this.labelSpan = label;

        // Add focus ring
        const focusRing = document.createElement("div");
        focusRing.className = "ds-focus-ring";

        button.appendChild(hoverBg);
        button.appendChild(label);
        button.appendChild(focusRing);

        this.containerEl = button;
        this.uploadButtonRef = uploadButton;

        // Append to body
        document.body.appendChild(button);

        // Add hover effect
        button.addEventListener('mouseenter', () => {
            hoverBg.style.backgroundColor = 'var(--ds-icon-button-hover-color, rgba(0, 0, 0, 0.05))';
        });
        button.addEventListener('mouseleave', () => {
            hoverBg.style.backgroundColor = 'transparent';
        });

        // Set initial position after button is rendered and has width
        // Cache the button width to avoid recalculation during hover
        let cachedButtonWidth = 0;
        requestAnimationFrame(() => {
            const uploadRect = uploadButton.getBoundingClientRect();
            cachedButtonWidth = button.offsetWidth;
            // Position based on upload button's position, accounting for our button width + gap
            button.style.left = `${uploadRect.left - cachedButtonWidth - 8}px`;
            button.style.top = `${uploadRect.top}px`;
        });

        // Update position on scroll/resize (use cached width to avoid jumps)
        const updatePosition = () => {
            const uploadRect = uploadButton.getBoundingClientRect();
            // Use cached width instead of recalculating to avoid hover-induced jumps
            button.style.left = `${uploadRect.left - cachedButtonWidth - 8}px`;
            button.style.top = `${uploadRect.top}px`;
        };

        window.addEventListener('scroll', updatePosition, { passive: true });
        window.addEventListener('resize', updatePosition, { passive: true });
    }

    private updateButtonPosition() {
        if (!this.containerEl || !this.uploadButtonRef) return;

        // Recalculate button width (in case content changed)
        this.cachedButtonWidth = this.containerEl.offsetWidth;

        // Update position
        const uploadRect = this.uploadButtonRef.getBoundingClientRect();
        this.containerEl.style.left = `${uploadRect.left - this.cachedButtonWidth - 8}px`;
        this.containerEl.style.top = `${uploadRect.top}px`;
    }

    private scheduleCompute(delay = 200) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.computeAndRender(), delay);
    }

    private async computeAndRender() {
        try {
            const now = performance.now();
            if (now - this.lastRun < 100) return;
            this.lastRun = now;

            this.ensureUiMounted();
            if (!this.labelSpan) return;

            const texts = this.getTextsFromPage();
            let totalTokens = 0;

            if (this.tokenizer) {
                if (DEBUG_LOG) {
                    console.log('[DeepSeekToken] === Starting token counting ===');
                    console.log('[DeepSeekToken] Number of text segments:', texts.length);
                }

                for (const t of texts) {
                    if (t) {
                        try {
                            const encoded = this.tokenizer.encode(t);
                            // Handle different return formats from tokenizer
                            if (encoded && encoded.ids) {
                                const tokenCount = encoded.ids.length;
                                totalTokens += tokenCount;
                                if (DEBUG_LOG) {
                                    console.log(`[DeepSeekToken] Encoded ${t.length} chars -> ${tokenCount} tokens`);
                                }
                            } else if (Array.isArray(encoded)) {
                                totalTokens += encoded.length;
                                if (DEBUG_LOG) {
                                    console.log(`[DeepSeekToken] Encoded ${t.length} chars -> ${encoded.length} tokens (array format)`);
                                }
                            } else {
                                console.warn('[DeepSeekToken] Unexpected encode result:', encoded);
                            }
                        } catch (err) {
                            console.error('[DeepSeekToken] Error encoding text:', err);
                        }
                    }
                }

                if (DEBUG_LOG) {
                    console.log('[DeepSeekToken] === Token counting complete ===');
                    console.log('[DeepSeekToken] Total tokens:', totalTokens);
                }
            } else {
                this.labelSpan.textContent = "Loading...";
                return;
            }

            if (totalTokens >= 1000) {
                this.labelSpan.textContent = `${(totalTokens / 1000).toFixed(1)}k tokens`;
            } else {
                this.labelSpan.textContent = `${totalTokens} tokens`;
            }

            // Update button position after text change (width may have changed)
            this.updateButtonPosition();
        } catch (e) {
            console.error("[DeepSeekToken] error:", e);
            if (this.labelSpan) this.labelSpan.textContent = "Error";
        }
    }

    private getObserveTargets(): Node[] {
        const main = document.querySelector("main");
        const body = document.body;
        const targets: Node[] = [body];
        if (main) targets.push(main);
        return targets;
    }

    private updateObserverTarget() {
        const newTargets = this.getObserveTargets();
        const same =
            this.observeTargets.length === newTargets.length &&
            newTargets.every((t, idx) => this.observeTargets[idx] === t);
        if (same) return;

        this.observeTargets = newTargets;
        if (this.mo) this.mo.disconnect();

        this.mo = new MutationObserver(() => {
            this.scheduleCompute(0);
            this.updateObserverTarget();
        });

        this.observeTargets.forEach((t) =>
            this.mo!.observe(t, {
                childList: true,
                subtree: true,
                characterData: true,
            })
        );
    }

    private onUrlChange() {
        this.containerEl = null;
        this.labelSpan = null;
        document.getElementById(BUTTON_ID)?.remove();
        this.updateObserverTarget();
        this.scheduleCompute(0);
    }
}
