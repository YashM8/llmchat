import { prisma } from '@repo/prisma';
import { geolocation } from '@vercel/functions';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    // userId is no longer available after removing Clerk auth.
    // const userId = undefined; 

    const { feedback } = await request.json();

    await prisma.feedback.create({
        data: {
            // userId: userId, // Association with userId removed
            feedback,
            metadata: JSON.stringify({
                geo: geolocation(request),
            }),
        },
    });

    return NextResponse.json({ message: 'Feedback received' }, { status: 200 });
}
