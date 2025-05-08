import { RagDocument } from '@repo/shared/types';
import { cn } from '@repo/ui';
import { memo } from 'react';

type RagDocumentsProps = {
    documents: RagDocument[];
};

export const RagDocuments = memo(({ documents }: RagDocumentsProps) => {
    if (!documents || documents.length === 0) {
        return null;
    }

    return (
        <div className="w-full mb-4">
            <div className="text-muted-foreground text-xs font-medium mb-2">
                Related documents:
            </div>
            <div className="flex flex-col gap-2">
                {documents.map((doc, index) => (
                    <div 
                        key={index} 
                        className="bg-muted/50 rounded-md p-3 border border-border"
                    >
                        <div className="flex justify-between items-start mb-1">
                            <div className="text-xs font-medium text-muted-foreground">
                                Document {index + 1}
                            </div>
                            <div className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                Score: {(doc.score * 100).toFixed(2)}%
                            </div>
                        </div>
                        <div className="text-sm whitespace-pre-wrap">{doc.text}</div>
                    </div>
                ))}
            </div>
        </div>
    );
});

RagDocuments.displayName = 'RagDocuments';