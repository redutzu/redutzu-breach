const resourceName = location.hostname.replace('cfx-nui-', '');

export type MockData<T> = {
    data: T,
    delay?: number
}

export async function fetchNui<T = unknown>(
    event: string,
    data?: unknown,
    mock?: MockData<T>
): Promise<T> {
    if (import.meta.env.DEV) {
        if (!mock) return new Promise<T>(() => {})
        await new Promise<void>(resolve => setTimeout(resolve, mock.delay ?? 0))
        return mock.data
    }

    const options = {
        method: 'post',
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(data)
    }

    const response = await fetch(`https://${resourceName}/${event}`, options)
    const result: T = await response.json()

    return result
}

export function devMock<T>(data: T, delay = 250): MockData<T> | undefined {
    return import.meta.env.DEV ? { data, delay } : undefined
}