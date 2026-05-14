local isRunning = false
local pendingCallback = nil

local function cleanup()
    isRunning = false
    pendingCallback = nil
    SetNuiFocus(false, false)
end

---@param config table|nil  optional overrides: totalTime, lives, seqLen, honeypots, honeyInterval, lockThreshold, id, ip
---@param callback fun(result: { success: boolean, reason: string?, match: number?, elapsed: number })|nil
local function startMinigame(config, callback)
    if isRunning then return false end
    config = config or {}
    isRunning = true
    pendingCallback = callback

    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'startBreach',
        data = {
            id      = config.id or 'cam-000',
            ip      = config.ip or '0.0.0.0',
            totalTime     = config.totalTime or Config.Time,
            lives         = config.lives or Config.Lives,
            seqLen        = config.seqLen or Config.SequenceLength,
            honeypots     = config.honeypots or Config.Honeypots,
            honeyInterval = config.honeyInterval or Config.HoneyInterval,
            lockThreshold = config.lockThreshold or Config.LockThreshold,
        }
    })
    return true
end

RegisterNUICallback('breachResult', function(data, cb)
    local fn = pendingCallback
    cleanup()
    if fn then
        fn({
            success = data.success,
            reason  = data.reason,
            match   = data.match,
            elapsed = data.elapsed,
        })
    end
    cb(true)
end)

-- Net-event path: server triggers the minigame, result fires back to server
RegisterNetEvent('redutzu-minigame:client:start', function(config)
    startMinigame(config, function(result)
        TriggerServerEvent('redutzu-minigame:server:result', result)
    end)
end)

RegisterNetEvent('redutzu-minigame:client:close', function()
    if not isRunning then return end
    SendNUIMessage({ action = 'closeBreach' })
    cleanup()
end)

-- Direct export for other client-side resources (e.g. your MDT client script)
-- Usage: exports['redutzu-cctv-hacking']:StartMinigame(config, callback)
exports('StartMinigame', startMinigame)

AddEventHandler('gameEventTriggered', function(name, args)
    if name ~= 'CEventNetworkEntityDamage' then return end
    if not isRunning then return end

    local victim, victimDied = args[1], args[4]
    if not IsEntityAPed(victim) then return end
    if not victimDied then return end
    if NetworkGetPlayerIndexFromPed(victim) ~= PlayerId() then return end
    if not IsEntityDead(PlayerPedId()) then return end

    SendNUIMessage({ action = 'closeBreach' })
    local fn = pendingCallback
    cleanup()
    if fn then fn({ success = false, reason = 'died', elapsed = 0 }) end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then return end
    if isRunning then
        SendNUIMessage({ action = 'closeBreach' })
        cleanup()
    end
end)