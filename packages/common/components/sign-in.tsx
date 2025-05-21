import { Button } from '@repo/ui';
import { IconX } from '@tabler/icons-react';

type CustomSignInProps = {
    onClose?: () => void;
};

export const CustomSignIn = ({ onClose }: CustomSignInProps) => {
    return (
        <>
            <Button
                onClick={() => {
                    onClose?.();
                }}
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-2"
            >
                <IconX className="h-4 w-4" />
            </Button>
            <div className="flex w-[320px] flex-col items-center gap-8">
                <h2 className="text-muted-foreground/70 text-center text-[24px] font-semibold leading-tight">
                    Authentication Removed
                </h2>
                <p className="text-muted-foreground text-center text-sm">
                    User sign-in and sign-up functionality has been removed from this application.
                </p>
                <div className="text-muted-foreground/50 w-full text-center text-xs">
                    <span className="text-muted-foreground/50">
                        By using this app, you agree to the{' '}
                    </span>
                    <a href="/terms" className="hover:text-foreground underline">
                        Terms of Service
                    </a>{' '}
                    and{' '}
                    <a href="/privacy" className="hover:text-foreground underline">
                        Privacy Policy
                    </a>
                </div>
                <Button variant="ghost" size="sm" className="w-full" onClick={onClose}>
                    Close
                </Button>
            </div>
        </>
    );
};
