import { NextRequest, NextResponse } from 'next/server';
import {
    DAILY_CREDITS_AUTH,
    DAILY_CREDITS_IP,
    getRemainingCredits,
} from '../../completion/credit-service';
import { getIp } from '../../completion/utils';

export async function GET(request: NextRequest) {
    const userId = undefined; // userId is no longer available after removing Clerk auth
    const ip = getIp(request);

    if (!ip) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const remainingCredits = await getRemainingCredits({ userId: undefined, ip }); // Pass undefined for userId
        const resetTime = getNextResetTime();

        return NextResponse.json(
            {
                remaining: remainingCredits,
                maxLimit: DAILY_CREDITS_IP, // Always use IP-based limit
                reset: new Date(resetTime).toISOString(),
                isAuthenticated: false, // isAuthenticated is always false
            },
            {
                headers: {
                    'X-Credits-Limit': DAILY_CREDITS_IP.toString(), // Always use IP-based limit
                    'X-Credits-Remaining': remainingCredits.toString(),
                    'X-Credits-Reset': resetTime.toString(),
                },
            }
        );
    } catch (error) {
        console.error('Credit check error:', error);
        if (error instanceof TypeError) {
            return NextResponse.json({ error: 'Invalid request format' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to fetch remaining credits' }, { status: 500 });
    }
}

function getNextResetTime(): number {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return tomorrow.getTime();
}
