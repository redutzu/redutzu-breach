local pending = {}

local function resolve(src, result)
    local fn = pending[src]
    if not fn then return end
    pending[src] = nil
    fn(result)
end

exports('StartMinigame', function(source, config, callback)
    pending[source] = callback
    TriggerClientEvent('redutzu-minigame:client:start', source, config or {})
end)

exports('CloseMinigame', function(source)
    TriggerClientEvent('redutzu-minigame:client:close', source)
end)

RegisterNetEvent('redutzu-minigame:server:result', function(result)
    local src = source
    resolve(src, result)
    TriggerEvent('redutzu-minigame:result', src, result)
end)

AddEventHandler('playerDropped', function()
    resolve(source, { success = false, reason = 'disconnected', elapsed = 0 })
end)
