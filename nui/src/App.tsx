import { useRef, useState } from "react";
import { BreachTerminal, type BreachTerminalConfig } from "./component/index";
import { fetchNui } from "./lib/fetchNui";
import { useNuiEvent } from "./lib/useNuiEvent";

// Fallback values used when the server omits a field or passes bad data.
const FALLBACK: Required<BreachTerminalConfig> = {
    id: 'cam-00',
    ip: '0.0.0.0',
    totalTime: 60,
    lives: 2,
    seqLen: 6,
    honeypots: 4,
    honeyInterval: 650,
    lockThreshold: 90,
};

function clamp(val: unknown, min: number, max: number, fallback: number): number {
    const n = Number(val);
    return isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function sanitize(raw: unknown): Required<BreachTerminalConfig> {
    const src = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
        id: typeof src.id === 'string' && src.id.trim() !== '' ? src.id.trim() : FALLBACK.id,
        ip: typeof src.ip === 'string' && src.ip.trim() !== '' ? src.ip.trim() : FALLBACK.ip,
        totalTime: clamp(src.totalTime, 10, 300, FALLBACK.totalTime),
        lives: clamp(src.lives, 1, 5, FALLBACK.lives),
        seqLen: clamp(src.seqLen, 2, 10, FALLBACK.seqLen),
        honeypots: clamp(src.honeypots, 0, 8, FALLBACK.honeypots),
        honeyInterval: clamp(src.honeyInterval, 300, 3000, FALLBACK.honeyInterval),
        lockThreshold: clamp(src.lockThreshold, 50, 99, FALLBACK.lockThreshold),
    };
}

export default function App() {
    const [visible, setVisible] = useState(false);
    const [config, setConfig] = useState<Required<BreachTerminalConfig>>(FALLBACK);
    const [breachKey, setBreachKey] = useState(0);
    const busyRef = useRef(false);

    const close = () => {
        setVisible(false);
        busyRef.current = false;
    };

    // Ignored while a breach is already active — no double-open, no reset mid-game.
    useNuiEvent<unknown>('startBreach', (raw) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setConfig(sanitize(raw));
        setBreachKey(k => k + 1); // force a clean remount every new breach
        setVisible(true);
    });

    // Safety valve: server can force-close at any time (player dies, admin, etc.)
    useNuiEvent('closeBreach', close);

    if (!visible) return null;

    return (
        <BreachTerminal
            key={breachKey}
            config={config}
            onComplete={(result) => {
                fetchNui('breachResult', result);
                close();
            }}
        />
    );
}
