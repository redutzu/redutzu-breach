Config = {}

Config.Time = 60           -- total seconds across both phases
Config.Lives = 2           -- wrong clicks before lockout
Config.SequenceLength = 6  -- ports in the knock sequence (Phase 1)
Config.Honeypots = 5       -- decoy ports spawned per rotation (Phase 1)
Config.HoneyInterval = 400 -- ms between honeypot position shuffles
Config.LockThreshold = 90  -- % carrier-wave sync required to engage lock (Phase 2)