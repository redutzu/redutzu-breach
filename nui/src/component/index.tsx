import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './index.module.css';

export interface BreachTerminalConfig {
    id?: string;
    ip?: string;
    totalTime?: number;
    lives?: number;
    seqLen?: number;
    honeypots?: number;
    honeyInterval?: number;
    lockThreshold?: number;
}

export interface BreachTerminalProps {
    config?: BreachTerminalConfig;
    onComplete?: (result: {
        success: boolean;
        reason?: 'timeout' | 'lockout' | 'win';
        match?: number;
        elapsed: number;
    }) => void;
}

type Phase = 'boot' | 'portKnock' | 'signalLock' | 'ended';
type BlockStatus = 'active' | 'done' | 'failed';
type LineVariant = 'out' | 'out-dim' | 'ok' | 'warn' | 'bad';

interface WaveFrame {
    freq: number;
    amp: number;
    phase: number;
    noise: number;
}

interface TerminalLine {
    id: number;
    markup: string;
    variant: LineVariant;
}

const DEFAULTS: Required<BreachTerminalConfig> = {
    id: 'lspd-cam-04',
    ip: '10.41.0.84',
    totalTime: 60,
    lives: 2,
    seqLen: 6,
    honeypots: 4,
    honeyInterval: 650,
    lockThreshold: 90,
};

const HEX = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

const LINE_CLASS: Record<LineVariant, string> = {
    'out': '',
    'out-dim': styles.line_out_dim,
    'ok': styles.line_ok,
    'warn': styles.line_warn,
    'bad': styles.line_bad,
};

function randomInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function extractText(html: string): string {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.textContent ?? el.innerText ?? '';
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function computeSyncMatch(user: WaveFrame, target: WaveFrame): number {
    const dFreq = Math.abs(user.freq - target.freq) / 350;
    const dAmp = Math.abs(user.amp - target.amp) / 90;
    const dPhase = Math.min(
        Math.abs(user.phase - target.phase),
        360 - Math.abs(user.phase - target.phase),
    ) / 180;
    const dNoise = Math.abs(user.noise - target.noise) / 100;
    return Math.max(0, (1 - (dFreq + dAmp + dPhase + dNoise) / 4) * 100);
}

export function BreachTerminal({ config = {}, onComplete }: BreachTerminalProps) {
    const cfg = { ...DEFAULTS, ...config };

    // Lifecycle
    const [sessionId] = useState(() => Math.random().toString(36).substring(2, 8).toUpperCase());
    const [phase, setPhase] = useState<Phase>('boot');
    const [lives, setLives] = useState(cfg.lives);
    const [timeLeft, setTimeLeft] = useState(cfg.totalTime);
    const [finished, setFinished] = useState(false);
    const [terminalState, setTerminalState] = useState<'idle' | 'glitch' | 'success' | 'broken'>('idle');

    // Terminal output
    const [lines, setLines] = useState<TerminalLine[]>([]);
    const lineIdRef = useRef(0);

    // Phase 1 — Port Knock
    const [sequence, setSequence] = useState<string[]>([]);
    const [currentStep, setCurrentStep] = useState(0);
    const [ports, setPorts] = useState<string[]>([]);
    const [honeypotSet, setHoneypotSet] = useState<Set<number>>(new Set());
    const [portFlash, setPortFlash] = useState<Record<number, 'ok' | 'bad'>>({});
    const [portKnockStatus, setPortKnockStatus] = useState<BlockStatus>('active');
    const [portKnockVisible, setPortKnockVisible] = useState(false);

    // Phase 2 — Signal Lock
    const [target, setTarget] = useState<WaveFrame>({ freq: 0, amp: 0, phase: 0, noise: 0 });
    const [userWave, setUserWave] = useState<WaveFrame>({ freq: 100, amp: 50, phase: 0, noise: 50 });
    const [syncPct, setSyncPct] = useState(0);
    const [signalLockStatus, setSignalLockStatus] = useState<BlockStatus>('active');
    const [signalLockVisible, setSignalLockVisible] = useState(false);

    // Refs — stable values needed inside intervals / animation loops
    const cancelledRef = useRef(false);
    const startedAtRef = useRef<number>(0);
    const portKnockAnchorRef = useRef<number>(Infinity);
    const signalLockAnchorRef = useRef<number>(Infinity);
    const honeyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timeLeftRef = useRef(cfg.totalTime);
    const signalLockVisibleRef = useRef(false);
    const animFrameRef = useRef<number | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const timePhaseRef = useRef(0);
    const userWaveRef = useRef(userWave);
    const targetRef = useRef(target);
    const phaseRef = useRef(phase);
    const finishedRef = useRef(finished);

    useEffect(() => { userWaveRef.current = userWave; }, [userWave]);
    useEffect(() => { targetRef.current = target; }, [target]);
    useEffect(() => { phaseRef.current = phase; }, [phase]);
    useEffect(() => { finishedRef.current = finished; }, [finished]);
    useEffect(() => { signalLockVisibleRef.current = signalLockVisible; }, [signalLockVisible]);

    // ── Helpers ────────────────────────────────────────────────

    const addLine = useCallback((markup: string, variant: LineVariant = 'out') => {
        setLines(prev => [...prev, { id: ++lineIdRef.current, markup, variant }]);
    }, []);

    const typeLine = useCallback(async (markup: string, variant: LineVariant = 'out', speed = 12) => {
        const text = extractText(markup);
        const id = ++lineIdRef.current;
        setLines(prev => [...prev, { id, markup: '', variant }]);

        for (let i = 1; i <= text.length; i++) {
            if (cancelledRef.current) return;
            const partial = text.substring(0, i);
            const isLast = i === text.length;
            setLines(prev => prev.map(l =>
                l.id !== id ? l : {
                    ...l,
                    markup: isLast
                        ? markup
                        : `${escapeHtml(partial)}<span class="${styles.cursor}"></span>`,
                }
            ));
            await sleep(speed + Math.random() * 8);
        }
        setLines(prev => prev.map(l => l.id === id ? { ...l, markup } : l));
    }, []);

    const triggerGlitch = useCallback(() => {
        setTerminalState('glitch');
        setTimeout(() => setTerminalState(prev => prev === 'glitch' ? 'idle' : prev), 400);
    }, []);

    // ── Phase 1: Port Knock ────────────────────────────────────

    const initPortKnock = useCallback(() => {
        const pool = new Set<string>();
        while (pool.size < 24) pool.add(HEX[randomInt(0, 15)] + HEX[randomInt(0, 15)]);
        const arr = [...pool];
        setPorts(arr);
        setSequence(shuffle(arr).slice(0, cfg.seqLen));
        setCurrentStep(0);
    }, [cfg.seqLen]);

    const spawnHoneypots = useCallback(() => {
        if (phaseRef.current !== 'portKnock' || finishedRef.current) return;
        setSequence(currentSeq => {
            setCurrentStep(currentStepLocal => {
                setPorts(portsLocal => {
                    const expected = currentSeq[currentStepLocal];
                    const available = portsLocal.map((v, i) => ({ v, i })).filter(p => p.v !== expected);
                    const next = new Set<number>();
                    for (const { i } of shuffle(available).slice(0, cfg.honeypots)) next.add(i);
                    setHoneypotSet(next);
                    return portsLocal;
                });
                return currentStepLocal;
            });
            return currentSeq;
        });
    }, [cfg.honeypots]);

    const handlePortClick = (idx: number) => {
        if (finishedRef.current || phaseRef.current !== 'portKnock') return;
        const expected = sequence[currentStep];
        const portVal = ports[idx];

        const flashAndClear = (result: 'ok' | 'bad') => {
            setPortFlash(prev => ({ ...prev, [idx]: result }));
            setTimeout(() => setPortFlash(prev => { const next = { ...prev }; delete next[idx]; return next; }), result === 'ok' ? 350 : 400);
        };

        if (honeypotSet.has(idx)) {
            flashAndClear('bad');
            loseLife(`port [${portVal}] honeypot trip — token consumed`);
            return;
        }

        if (portVal === expected) {
            flashAndClear('ok');
            const nextStep = currentStep + 1;
            setCurrentStep(nextStep);
            if (nextStep >= sequence.length) void startSignalLock();
        } else {
            flashAndClear('bad');
            loseLife(`port [${portVal}] rejected — expected [${expected}]`);
        }
    };

    // ── Phase 2: Signal Lock ───────────────────────────────────

    const initSignalLockTarget = useCallback(() => {
        const defaultWave: WaveFrame = { freq: 100, amp: 50, phase: 0, noise: 50 };
        let t: WaveFrame;
        let attempts = 0;
        do {
            t = {
                freq: randomInt(70, 380),
                amp: randomInt(25, 95),
                phase: randomInt(20, 340),
                noise: randomInt(15, 85),
            };
            attempts++;
        } while (computeSyncMatch(defaultWave, t) > 45 && attempts < 10);
        setTarget(t);
        setUserWave(defaultWave);
    }, []);

    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }, []);

    const drawScope = useCallback(() => {
        if (phaseRef.current !== 'signalLock' || finishedRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) { animFrameRef.current = requestAnimationFrame(drawScope); return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        const W = rect.width, H = rect.height, midY = H / 2;

        ctx.fillStyle = '#030504';
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = 'rgba(60,100,60,0.12)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= W; x += W / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y <= H; y += H / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        const drawWave = (frame: WaveFrame, color: string, lineWidth: number, withNoise: boolean) => {
            const freq = frame.freq / 100;
            const amp = (frame.amp / 100) * (H * 0.35);
            const phaseRad = frame.phase * Math.PI / 180;
            const noiseAmt = (1 - frame.noise / 100) * (H * 0.1);
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            for (let x = 0; x <= W; x += 1.5) {
                const angle = (x / W) * Math.PI * 2 * freq;
                let y = midY + Math.sin(angle + phaseRad + timePhaseRef.current) * amp;
                if (withNoise && noiseAmt > 0) y += (Math.random() - 0.5) * noiseAmt;
                x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        };

        drawWave(targetRef.current, 'rgba(120,160,125,0.45)', 1.5, false);
        drawWave(userWaveRef.current, '#6fc97a', 1.7, true);

        setSyncPct(computeSyncMatch(userWaveRef.current, targetRef.current));
        timePhaseRef.current += 0.04;
        animFrameRef.current = requestAnimationFrame(drawScope);
    }, []);

    const handleLockAttempt = () => {
        if (finishedRef.current || phaseRef.current !== 'signalLock') return;
        const match = computeSyncMatch(userWave, target);
        if (match >= cfg.lockThreshold) {
            void endGame(true, match);
        } else {
            loseLife(`carrier lock failed @ ${match.toFixed(1)}% — below ${cfg.lockThreshold}% threshold`);
        }
    };

    // ── Shared lifecycle ───────────────────────────────────────

    const loseLife = (reason: string) => {
        setLives(prev => {
            const next = prev - 1;
            addLine(`<span style="color:var(--crit)">⚠ ${reason}</span>`, 'bad');
            triggerGlitch();
            if (next <= 0) void endGame(false);
            return next;
        });
    };

    const startSignalLock = async () => {
        if (honeyIntervalRef.current) clearInterval(honeyIntervalRef.current);
        setHoneypotSet(new Set());
        setPortKnockStatus('done');

        await sleep(300);
        await typeLine('[+] mgmt interface exposed on :8000', 'ok', 6);
        await typeLine(`<span class="${styles.prompt}">root@kestrel</span>:~# <span class="${styles.cmd}">./sigtune --rtsp ${cfg.ip}:554 --carrier 2.4ghz</span>`, 'out', 14);
        await sleep(200);
        await typeLine('[*] sniffing carrier waveform...', 'out-dim', 6);
        await typeLine('[+] target signature captured, sync required', 'ok', 6);
        await sleep(200);

        signalLockAnchorRef.current = lineIdRef.current;
        initSignalLockTarget();
        setSignalLockVisible(true);
        setPhase('signalLock');
    };

    const endGame = async (success: boolean, finalMatch: number | null = null, timeout = false) => {
        if (finishedRef.current) return;
        setFinished(true);
        setPhase('ended');

        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        if (honeyIntervalRef.current) clearInterval(honeyIntervalRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

        if (signalLockVisibleRef.current) {
            setSignalLockStatus(success ? 'done' : 'failed');
        } else {
            setPortKnockStatus(success ? 'done' : 'failed');
        }

        await sleep(400);
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);

        if (success) {
            setTerminalState('success');
            await typeLine('[+] sync established', 'ok', 5);
            await typeLine('[+] forging frame headers...', 'ok', 6);
            await typeLine('[+] injecting spoof stream into rtsp pipe', 'ok', 6);
            await typeLine('[+] operator console reports nominal feed', 'ok', 6);
            await sleep(200);
            addLine('', 'out');
            addLine(`<span class="${styles.bigStatus} ${styles.bigStatusOk}">&gt;&gt; ACCESS GRANTED</span>`);
            await sleep(150);
            await typeLine(
                `<span style="color:var(--term-dim);">camera ${cfg.id} ::: mirror active ::: match ${(finalMatch ?? 0).toFixed(1)}% ::: ${elapsed}s elapsed ::: ${lives}/${cfg.lives} tokens</span>`,
                'out-dim', 4,
            );
            onComplete?.({ success: true, reason: 'win', match: finalMatch ?? undefined, elapsed });
        } else {
            setTerminalState('broken');
            if (timeout) {
                await typeLine('<span style="color:var(--warn)">[!] session window closed</span>', 'warn', 8);
                await typeLine('[!] connection severed by host', 'bad', 6);
            } else {
                await typeLine('<span style="color:var(--crit)">[!] intrusion-detection flagged channel</span>', 'bad', 8);
                await typeLine('[!] target raised firewall · all tokens consumed', 'bad', 6);
            }
            await typeLine('[!] kernel: signal SIGTERM received', 'bad', 5);
            await typeLine('[!] panic — unable to maintain spoof stream', 'bad', 5);
            await sleep(200);
            addLine('', 'out');
            addLine(`<span class="${styles.bigStatus} ${styles.bigStatusBad}" data-text="&gt;&gt; ACCESS DENIED">&gt;&gt; ACCESS DENIED</span>`);
            await sleep(150);
            const failReason = timeout ? 'time exhausted' : 'token quota depleted';
            const phaseNum = signalLockVisibleRef.current ? 2 : 1;
            await typeLine(
                `<span style="color:var(--crit);">phase ${phaseNum} ::: ${failReason} ::: ids: FLAGGED</span>`,
                'bad', 4,
            );
            onComplete?.({ success: false, reason: timeout ? 'timeout' : 'lockout', elapsed });
        }
    };

    // ── Boot sequence ──────────────────────────────────────────

    const bootSequence = useCallback(async () => {
        await typeLine(`<span class="${styles.prompt}">root@kestrel</span>:<span style="color:var(--next)">~</span># <span class="${styles.cmd}">./breach.sh --target ${cfg.id}</span>`, 'out', 18);
        await sleep(200);
        await typeLine('[*] initializing breach kit v2.4.1...', 'out-dim', 8);
        await sleep(150);
        await typeLine(`[*] loading payloads: <span style="color:var(--term-bright)">tcpsynack, sigtune</span>`, 'out-dim', 8);
        await sleep(200);
        await typeLine(`<span class="${styles.prompt}">root@kestrel</span>:~# <span class="${styles.cmd}">nmap -sS -p- 10.41.0.0/24 --max-rate 500</span>`, 'out', 14);
        await sleep(300);
        await typeLine('Starting Nmap 7.94 ( https://nmap.org )', 'out-dim', 5);
        await typeLine(`Nmap scan report for ${cfg.id}.local (${cfg.ip})`, 'out-dim', 5);
        await typeLine('Host is up (0.0021s latency).', 'out-dim', 5);
        await typeLine('Not shown: 65521 filtered ports', 'out-dim', 5);
        await typeLine('PORT      STATE   SERVICE', 'out-dim', 5);
        await typeLine('554/tcp   open    rtsp', 'out-dim', 5);
        await typeLine('8000/tcp  open    http-alt', 'out-dim', 5);
        await typeLine('<span style="color:var(--warn)">[!] device fingerprint: Hikvision DS-2CD2T (firmware 5.4.5)</span>', 'warn', 5);
        await sleep(250);
        await typeLine(`<span class="${styles.prompt}">root@kestrel</span>:~# <span class="${styles.cmd}">./tcpsynack --target ${cfg.ip} --probe</span>`, 'out', 14);
        await sleep(200);
        await typeLine('[+] handshake captured', 'ok', 6);
        await typeLine('[+] knock sequence required to expose mgmt interface', 'ok', 6);
        await typeLine('[*] dumping required sequence from capture buffer...', 'out-dim', 8);
        await sleep(400);

        if (cancelledRef.current) return;

        portKnockAnchorRef.current = lineIdRef.current;
        initPortKnock();
        setPortKnockVisible(true);
        setPhase('portKnock');
        startedAtRef.current = Date.now();
    }, [cfg.id, cfg.ip, initPortKnock, typeLine]);

    // ── Effects ────────────────────────────────────────────────

    useEffect(() => {
        cancelledRef.current = false;
        void bootSequence();
        return () => {
            cancelledRef.current = true;
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            if (honeyIntervalRef.current) clearInterval(honeyIntervalRef.current);
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [lines]);

    // Timer starts with phase 1 and runs through phase 2
    useEffect(() => {
        if (phase !== 'portKnock' || timerIntervalRef.current) return;
        timerIntervalRef.current = setInterval(() => {
            if (finishedRef.current) return;
            const next = Math.max(0, timeLeftRef.current - 1);
            timeLeftRef.current = next;
            setTimeLeft(next);
            if (next <= 0) void endGame(false, null, true);
        }, 1000);
        // no cleanup — timer outlives phase 1; cleared by endGame and unmount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    useEffect(() => {
        if (phase !== 'portKnock' || finished) return;
        spawnHoneypots();
        honeyIntervalRef.current = setInterval(spawnHoneypots, cfg.honeyInterval);
        return () => {
            if (honeyIntervalRef.current) { clearInterval(honeyIntervalRef.current); honeyIntervalRef.current = null; }
        };
    }, [phase, finished, spawnHoneypots, cfg.honeyInterval]);

    useEffect(() => {
        if (phase !== 'signalLock' || finished) return;
        resizeCanvas();
        drawScope();
        window.addEventListener('resize', resizeCanvas);
        return () => {
            window.removeEventListener('resize', resizeCanvas);
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [phase, finished, resizeCanvas, drawScope]);

    // ── Derived display values ─────────────────────────────────

    const timerStr = `${String(Math.floor(timeLeft / 60)).padStart(2, '0')}:${String(timeLeft % 60).padStart(2, '0')}`;
    const timerCls = timeLeft <= 5 ? styles.timerCrit : timeLeft <= 15 ? styles.timerWarn : '';

    const renderLines = (from: number, to: number) =>
        lines.filter(l => l.id > from && l.id <= to).map(l => (
            <div
                key={l.id}
                className={`${styles.line} ${LINE_CLASS[l.variant]}`}
                dangerouslySetInnerHTML={{ __html: l.markup }}
            />
        ));

    // ============================================================
    // Render
    // ============================================================

    return (
        <div className={styles.root}>
            <div className={`${styles.terminal} ${styles[`term_${terminalState}`]}`}>

                <div className={styles.statusBar}>
                    <div className={styles.sess}>sess <span className={styles.sessV}>{sessionId}</span></div>
                    <div className={`${styles.timer} ${timerCls}`}>{timerStr}</div>
                    <div className={styles.livesCells}>
                        {Array.from({ length: cfg.lives }).map((_, i) => (
                            <div key={i} className={`${styles.lifeCell} ${i >= lives ? styles.lifeCellLost : ''}`} />
                        ))}
                    </div>
                </div>

                <div className={styles.termScroll} ref={scrollRef}>

                    {renderLines(-1, portKnockAnchorRef.current)}

                    {/* Phase 1 — Port Knock */}
                    {portKnockVisible && (
                        <div className={styles.actionBlock} data-status={portKnockStatus}>
                            <div className={styles.abTitle}>
                                {portKnockStatus === 'active' && '// PORT KNOCK SEQUENCE'}
                                {portKnockStatus === 'done' && <span style={{ color: 'var(--term-bright)' }}>✓ PORT KNOCK SEQUENCE — ACCEPTED</span>}
                                {portKnockStatus === 'failed' && <span style={{ color: 'var(--crit)' }}>✗ PORT KNOCK SEQUENCE — FAILED</span>}
                            </div>
                            <div className={styles.sequence}>
                                {sequence.map((port, i) => (
                                    <div
                                        key={i}
                                        className={`${styles.seqSlot} ${i < currentStep ? styles.seqSlotDone : ''} ${i === currentStep ? styles.seqSlotNext : ''}`}
                                    >{port}</div>
                                ))}
                            </div>
                            <div className={styles.gridWrap}>
                                {ports.map((port, i) => (
                                    <div
                                        key={i}
                                        className={`${styles.port} ${honeypotSet.has(i) ? styles.portHoneypot : ''} ${portFlash[i] === 'ok' ? styles.portFlashOk : ''} ${portFlash[i] === 'bad' ? styles.portFlashBad : ''}`}
                                        onClick={() => handlePortClick(i)}
                                    >{port}</div>
                                ))}
                            </div>
                            {portKnockStatus === 'active' && (
                                <div className={styles.abHint}>click ports in the order shown above · honeypots will burn a token</div>
                            )}
                        </div>
                    )}

                    {renderLines(portKnockAnchorRef.current, signalLockAnchorRef.current)}

                    {/* Phase 2 — Signal Lock */}
                    {signalLockVisible && (
                        <div className={styles.actionBlock} data-status={signalLockStatus}>
                            <div className={styles.abTitle}>
                                {signalLockStatus === 'active' && '// CARRIER WAVE SYNC'}
                                {signalLockStatus === 'done' && <span style={{ color: 'var(--term-bright)' }}>✓ CARRIER WAVE SYNC — LOCKED</span>}
                                {signalLockStatus === 'failed' && <span style={{ color: 'var(--crit)' }}>✗ CARRIER WAVE SYNC — FAILED</span>}
                            </div>
                            <div className={styles.scope}>
                                <canvas ref={canvasRef} width={900} height={130} />
                                <div className={styles.scopePct}>SYNC <span className={styles.scopePctV}>{String(Math.floor(syncPct)).padStart(2, '0')}%</span></div>
                            </div>
                            <div className={styles.meter}>
                                <div
                                    className={`${styles.meterFill} ${syncPct >= cfg.lockThreshold ? styles.meterFillGood : syncPct >= 60 ? styles.meterFillMid : ''}`}
                                    style={{ width: `${syncPct}%` }}
                                />
                                <div className={styles.lockThreshold} style={{ left: `${cfg.lockThreshold}%` }} />
                            </div>
                            <div className={styles.controls}>
                                {([
                                    { id: 'freq', label: 'Freq', min: 50, max: 400, fmt: (v: number) => (v / 100).toFixed(2) },
                                    { id: 'amp', label: 'Amp', min: 10, max: 100, fmt: (v: number) => String(v) },
                                    { id: 'phase', label: 'Phase', min: 0, max: 360, fmt: (v: number) => `${v}°` },
                                    { id: 'noise', label: 'Filter', min: 0, max: 100, fmt: (v: number) => String(v) },
                                ] as const).map(ctrl => (
                                    <div key={ctrl.id} className={styles.control}>
                                        <div className={styles.controlHeader}>
                                            <span className={styles.controlLabel}>{ctrl.label}</span>
                                            <span className={styles.controlValue}>{ctrl.fmt(userWave[ctrl.id])}</span>
                                        </div>
                                        <input
                                            type="range"
                                            className={styles.slider}
                                            min={ctrl.min}
                                            max={ctrl.max}
                                            value={userWave[ctrl.id]}
                                            onChange={e => setUserWave(u => ({ ...u, [ctrl.id]: Number(e.target.value) }))}
                                            disabled={signalLockStatus !== 'active'}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className={styles.lockRow}>
                                <button
                                    className={styles.btnLock}
                                    disabled={syncPct < cfg.lockThreshold || signalLockStatus !== 'active'}
                                    onClick={handleLockAttempt}
                                >ENGAGE LOCK</button>
                            </div>
                            {signalLockStatus === 'active' && (
                                <div className={styles.abHint}>
                                    {syncPct < 40 && 'tune sliders until your signal overlays the target waveform'}
                                    {syncPct >= 40 && syncPct < cfg.lockThreshold && 'closer — fine-tune for lock'}
                                    {syncPct >= cfg.lockThreshold && 'lock available — press ENGAGE'}
                                </div>
                            )}
                        </div>
                    )}

                    {renderLines(signalLockAnchorRef.current, Infinity)}

                </div>
            </div>
        </div>
    );
}
