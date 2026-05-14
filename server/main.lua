local pending = {}

local function resolve(src, result)
    local entry = pending[src]
    if not entry then return end
    pending[src] = nil
    if entry.type == 'promise' then
        entry.p:resolve(result)
    else
        entry.fn(result)
    end
end

exports('StartMinigame', function(source, config, callback)
    if callback then
        pending[source] = { type = 'callback', fn = callback }
        TriggerClientEvent('redutzu-minigame:client:start', source, config or {})
    else
        local p = promise.new()
        pending[source] = { type = 'promise', p = p }
        TriggerClientEvent('redutzu-minigame:client:start', source, config or {})
        return p
    end
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
