import { getEncoding } from "js-tiktoken";
import { BaseHandler } from "../core/BaseHandler";
import { formatTokenCount } from "../utils/format";

const KEY = "ai_chat_token_encoder";
const BUTTON_ID = "token-counter-button";
const LABEL_ATTRIBUTE = "data-token-counter-label";
const DEBUG_LOG = false;
type EncoderName = "o200k_base" | "cl100k_base";

export class ChatGPTHandler extends BaseHandler {
    private currentEnc: EncoderName =
        (localStorage.getItem(KEY) as EncoderName) || "o200k_base";
    private encoders = new Map<EncoderName, ReturnType<typeof getEncoding>>();
    private buttonEl: HTMLButtonElement | null = null;
    private labelSpan: HTMLSpanElement | null = null;
    private popperWrapper: HTMLDivElement | null = null;
    private menuContent: HTMLDivElement | null = null;
    private charsItem: HTMLDivElement | null = null;
    private turnsItem: HTMLDivElement | null = null;
    private encoderItem: HTMLDivElement | null = null;
    private switchItem: HTMLDivElement | null = null;
    private timer: number | null = null;
    private lastRun = 0;
    private observeTargets: Node[] = [];
    private lastHref = location.href;

    init() {
        this.updateObserverTarget();
        this.scheduleCompute(0);

        const urlCheckTimer = window.setInterval(() => {
            const href = location.href;
            if (href !== this.lastHref) {
                this.lastHref = href;
                this.onUrlChange();
            }
        }, 500);
        this.registerTimer(urlCheckTimer);

        const mountCheckTimer = window.setInterval(() => {
            const btn = document.getElementById(BUTTON_ID);
            const needsMount = !btn || !document.body.contains(btn);
            const stale = performance.now() - this.lastRun > 1500;
            if (needsMount || stale) {
                this.scheduleCompute(0);
            }
        }, 1200);
        this.registerTimer(mountCheckTimer);

        const titleEl = document.querySelector("title");
        if (titleEl) {
            const titleObserver = new MutationObserver(() => {
                this.scheduleCompute(0);
            });
            titleObserver.observe(titleEl, { childList: true });
            this.registerObserver(titleObserver);
        }

        window.addEventListener("load", () => {
            this.scheduleCompute(0);
        });

        const reposition = () => {
            if (this.popperWrapper && this.popperWrapper.style.display === "block") {
                this.openMenu();
            }
        };
        window.addEventListener("scroll", reposition, { passive: true });
        window.addEventListener("resize", reposition, { passive: true });
    }

    destroy() {
        super.destroy(); // Cleanup timers and observers
        this.closeMenu();
        document.getElementById(BUTTON_ID)?.remove();
    }

    private getEncoder(name: EncoderName) {
        if (!this.encoders.has(name)) {
            this.encoders.set(name, getEncoding(name));
        }
        return this.encoders.get(name)!;
    }

    private getTextsFromPage(): string[] {
        const nodes = document.querySelectorAll<HTMLElement>(
            "[data-message-author-role]"
        );
        return Array.from(nodes)
            .map((n) => {
                const inner =
                    n.querySelector<HTMLElement>(".markdown") ||
                    n.querySelector<HTMLElement>(".prose") ||
                    n;
                return (inner.textContent || "").trim();
            })
            .filter(Boolean);
    }

    private createMenuDom() {
        if (this.popperWrapper && document.body.contains(this.popperWrapper)) return;

        this.popperWrapper = document.createElement("div");
        this.popperWrapper.setAttribute("data-radix-popper-content-wrapper", "");
        this.popperWrapper.dir = "ltr";
        this.popperWrapper.style.position = "fixed";
        this.popperWrapper.style.left = "0px";
        this.popperWrapper.style.top = "0px";
        this.popperWrapper.style.transform = "translate(0px, 0px)";
        this.popperWrapper.style.minWidth = "max-content";
        this.popperWrapper.style.zIndex = "50";
        this.popperWrapper.style.willChange = "transform";
        this.popperWrapper.style.display = "none";

        this.menuContent = document.createElement("div");
        this.menuContent.setAttribute("data-side", "bottom");
        this.menuContent.setAttribute("data-align", "end");
        this.menuContent.setAttribute("role", "menu");
        this.menuContent.setAttribute("aria-orientation", "vertical");
        this.menuContent.setAttribute("data-radix-menu-content", "");
        this.menuContent.dir = "ltr";
        this.menuContent.tabIndex = -1;
        this.menuContent.dataset.state = "open";
        this.menuContent.className =
            "z-50 max-w-xs rounded-2xl popover bg-token-main-surface-primary " +
            "dark:bg-[#353535] shadow-long will-change-[opacity,transform] " +
            "radix-side-bottom:animate-slideUpAndFade radix-side-left:animate-slideRightAndFade " +
            "radix-side-right:animate-slideLeftAndFade radix-side-top:animate-slideDownAndFade " +
            "py-1.5 data-[unbound-width]:min-w-[unset] data-[custom-padding]:py-0 " +
            "[--trigger-width:calc(var(--radix-dropdown-menu-trigger-width)-2*var(--radix-align-offset))] " +
            "min-w-(--trigger-width) max-h-[var(--radix-dropdown-menu-content-available-height)] " +
            "overflow-y-auto select-none text-sm";

        const makeItem = (): HTMLDivElement => {
            const item = document.createElement("div");
            item.role = "menuitem";
            item.tabIndex = 0;
            item.dataset.orientation = "vertical";
            item.setAttribute("data-radix-collection-item", "");
            item.className =
                "group __menu-item gap-1.5 px-4 py-1.5 text-token-text-primary " +
                "hover:bg-token-main-surface-secondary cursor-default";
            return item;
        };

        this.charsItem = makeItem();
        this.charsItem.textContent = "Chars: 0";

        this.turnsItem = makeItem();
        this.turnsItem.textContent = "Turns: 0";

        this.encoderItem = makeItem();
        this.encoderItem.textContent = `Encoder: ${this.currentEnc}`;

        const sep = document.createElement("div");
        sep.role = "separator";
        sep.className =
            "bg-token-border-default h-px mx-4 my-1 first:hidden last:hidden";

        this.switchItem = makeItem();
        this.switchItem.textContent = "Switch encoder";
        this.switchItem.dataset.color = "danger";
        this.switchItem.className +=
            " text-token-text-secondary hover:text-token-text-primary";

        this.switchItem.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.currentEnc =
                this.currentEnc === "o200k_base" ? "cl100k_base" : "o200k_base";
            localStorage.setItem(KEY, this.currentEnc);
            this.lastRun = 0;
            this.scheduleCompute(0);
            if (this.encoderItem) this.encoderItem.textContent = `Encoder: ${this.currentEnc}`;
            this.closeMenu();
        });

        this.menuContent.appendChild(this.charsItem);
        this.menuContent.appendChild(this.turnsItem);
        this.menuContent.appendChild(this.encoderItem);
        this.menuContent.appendChild(sep);
        this.menuContent.appendChild(this.switchItem);

        this.popperWrapper.appendChild(this.menuContent);
        document.body.appendChild(this.popperWrapper);
    }

    private openMenu() {
        if (!this.buttonEl || !this.popperWrapper || !this.menuContent) return;

        this.popperWrapper.style.display = "block";

        const btnRect = this.buttonEl.getBoundingClientRect();
        const menuRect = this.menuContent.getBoundingClientRect();

        let x = btnRect.left;
        const y = btnRect.bottom + 4;

        const vw = window.innerWidth;
        const margin = 8;
        if (x + menuRect.width + margin > vw) {
            x = Math.max(margin, vw - menuRect.width - margin);
        }

        this.popperWrapper.style.left = "0px";
        this.popperWrapper.style.top = "0px";
        this.popperWrapper.style.transform = `translate(${x}px, ${y}px)`;
    }

    private closeMenu() {
        if (this.popperWrapper) {
            this.popperWrapper.style.display = "none";
        }
    }

    private toggleMenu() {
        if (!this.popperWrapper) return;
        if (this.popperWrapper.style.display === "block") {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    private ensureUiMounted() {
        const bar = document.querySelector<HTMLElement>(
            "#conversation-header-actions"
        );
        if (!bar) {
            this.buttonEl = null;
            this.labelSpan = null;
            return;
        }

        const existingButton = bar.querySelector<HTMLButtonElement>(
            `#${BUTTON_ID}`
        );
        if (existingButton) {
            this.buttonEl = existingButton;
            this.labelSpan = existingButton.querySelector<HTMLSpanElement>(
                `[${LABEL_ATTRIBUTE}="true"]`
            );
            return;
        }

        document
            .querySelectorAll<HTMLButtonElement>(`#${BUTTON_ID}`)
            .forEach((btn) => btn.remove());
        document.getElementById("token-counter-wrapper")?.remove();

        const btn = document.createElement("button");
        btn.id = BUTTON_ID;
        btn.type = "button";
        btn.className =
            "btn relative btn-ghost text-token-text-primary hover:bg-token-surface-hover keyboard-focused:bg-token-surface-hover rounded-lg max-sm:hidden";

        const label = document.createElement("span");
        label.textContent = "0.0k tokens";
        label.setAttribute(LABEL_ATTRIBUTE, "true");
        this.labelSpan = label;

        btn.appendChild(label);
        this.buttonEl = btn;

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.createMenuDom();
            this.lastRun = 0;
            this.computeAndRender();
            this.toggleMenu();
        });

        bar.prepend(btn);

        // @ts-ignore
        if (!(document as any).__tokenCounterClickBound) {
            document.addEventListener("click", (ev) => {
                if (!this.popperWrapper || !this.buttonEl) return;
                const target = ev.target as Node;
                if (!this.popperWrapper.contains(target) && !this.buttonEl.contains(target)) {
                    this.closeMenu();
                }
            });
            // @ts-ignore
            (document as any).__tokenCounterClickBound = true;
        }
    }

    private scheduleCompute(delay = 200) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.computeAndRender(), delay);
    }

    private computeAndRender() {
        try {
            const now = performance.now();
            if (now - this.lastRun < 100) return;
            this.lastRun = now;

            this.ensureUiMounted();
            if (!this.buttonEl) return;

            const encoder = this.getEncoder(this.currentEnc);
            const texts = this.getTextsFromPage();

            let total = 0;
            for (const t of texts) {
                total += encoder.encode(t).length;
            }

            const chars = texts.join("\n").length;
            const turns = texts.length;

            if (this.labelSpan) {
                this.labelSpan.textContent = formatTokenCount(total);
            }
            if (this.charsItem) this.charsItem.textContent = `Chars: ${chars}`;
            if (this.turnsItem) this.turnsItem.textContent = `Turns: ${turns}`;
            if (this.encoderItem)
                this.encoderItem.textContent = `Encoder: ${this.currentEnc}`;
        } catch (e) {
            console.error("[TokenCounter] error:", e);
            if (this.labelSpan) this.labelSpan.textContent = "Token: error";
        }
    }

    private getObserveTargets(): Node[] {
        const header = document.querySelector<HTMLElement>("#page-header");
        return header ? [header, document.body] : [document.body];
    }

    private updateObserverTarget() {
        const newTargets = this.getObserveTargets();
        const same =
            this.observeTargets.length === newTargets.length &&
            newTargets.every((t, idx) => this.observeTargets[idx] === t);
        if (same) return;

        this.observeTargets = newTargets;

        const mo = new MutationObserver((records) => {
            const btn = document.getElementById(BUTTON_ID);
            const onlySelfMutations =
                btn &&
                records.every((record) => {
                    const target = record.target as Node;
                    return target === btn || btn.contains(target);
                });
            if (!onlySelfMutations) {
                this.scheduleCompute(0);
            }
            this.updateObserverTarget();
        });
        this.registerObserver(mo);

        this.observeTargets.forEach((t) =>
            mo.observe(t, {
                childList: true,
                subtree: true,
                characterData: true,
            })
        );
    }

    private onUrlChange() {
        this.buttonEl = null;
        this.labelSpan = null;
        this.closeMenu();
        document.getElementById(BUTTON_ID)?.remove();
        this.updateObserverTarget();
        this.scheduleCompute(0);
    }
}
