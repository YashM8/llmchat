import { useAuth, useUser } from '@clerk/nextjs';
import { useWorkflowWorker } from '@repo/ai/worker';
import { ChatMode, ChatModeConfig } from '@repo/shared/config';
import { ThreadItem } from '@repo/shared/types';
import { buildCoreMessagesFromThreadItems, plausible } from '@repo/shared/utils';
import { nanoid } from 'nanoid';
import { useParams, useRouter } from 'next/navigation';
import { useState, createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { useApiKeysStore, useAppStore, useChatStore, useMcpToolsStore } from '../store';

export type AgentContextType = {
    runAgent: (body: any) => Promise<void>;
    handleSubmit: (args: {
        formData: FormData;
        newThreadId?: string;
        existingThreadItemId?: string;
        newChatMode?: string;
        messages?: ThreadItem[];
        useWebSearch?: boolean;
        showSuggestions?: boolean;
    }) => Promise<void>;
    updateContext: (threadId: string, data: any) => void;
};

const TOP_K = 3;
const RAG_INSTRUCTIONS = `### Task:
You are an assistant helping medical professionals use the CANMAT 2018 Guidelines for Bipolar Disorder.
Respond to the query using information from the provided Context Documents, which are excerpts from the CANMAT Guidelines. 
Incorporate inline citations in the format [source_id].

### Example of Citation:
If the user asks about a specific topic and the information is found in a document that includes <source_id>3.3.5</source_id>, the response should include the citation like so:  
"The proposed method increases efficiency by 20% [3.3.5]."

### Output:
Provide a clear and direct response to the user's query, including inline citations in the format [source_id] only when the <source_id> tag is present in the context.
Finish your response with "Task completed with RAG".

Here are the context passages:

`

const AgentContext = createContext<AgentContextType | undefined>(undefined);
import * as https from 'https';

function getEmbeddings(inputTexts: string[], task: string): Promise<{ text: string, embedding: number[] }[]> {
    const data = JSON.stringify({
        model: "jina-embeddings-v3",
        task: task,
        input: inputTexts
    });


    const options = {
        hostname: 'api.jina.ai',
        port: 443,
        path: '/v1/embeddings',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer jina_14d53df0cfc745238405fda91e43646ahs4I-7GylX9OUA-MXZNk15XjYOj4', //
            'Content-Length': data.length
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    if (result.data && Array.isArray(result.data)) {
                        const output = result.data.map((item: any, index: number) => ({
                            text: inputTexts[index],
                            embedding: item.embedding
                        }));
                        resolve(output);
                    } else {
                        reject(new Error("Unexpected response format"));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

// 3) helper for cosine similarity
const cosineSim = (a: number[], b: number[]): number => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
};


export const AgentProvider = ({ children }: { children: ReactNode }) => {
    const { threadId: currentThreadId } = useParams();
    const { isSignedIn } = useAuth();
    const { user } = useUser();

    // Use the chat store for RAG embeddings
    const { getRagEmbeddings, setRagEmbeddings } = useChatStore(state => ({
        getRagEmbeddings: state.getRagEmbeddings,
        setRagEmbeddings: state.setRagEmbeddings
    }));

    useEffect(() => {
    const TSV_PATH = 'docs_modified.tsv'; // Adjust this as needed
    const BATCH_SIZE = 10;

    const fetchAndEmbedTSV = async () => {
        // Check if we already have embeddings in the store
        const existingEmbeddings = getRagEmbeddings();
        if (existingEmbeddings && existingEmbeddings.length > 0) {
            console.log(`🎉 Using ${existingEmbeddings.length} existing embeddings from store`);
            return;
        }

        try {
            const res = await fetch(TSV_PATH);
            const raw = await res.text();
            console.log(raw);

            const lines = raw.trim().split('\n');
            const texts = lines
                  .map((line, idx) => {
                    const cols = line.split('\t');
                    if (cols.length <= 3 || !cols[2]?.trim()) {
                    //   console.warn(`⚠️ Skipping invalid line ${idx + 1}:`, line);
                      return null;
                    }
                    return `<source_id>${cols[3]}</source_id>${cols[2].trim()}`;
                  })
                  .filter((text): text is string => !!text);


            const results: { text: string; embedding: number[] }[] = [];

            for (let i = 0; i < texts.length; i += BATCH_SIZE) {
                const batch = texts.slice(i, i + BATCH_SIZE);
                try {
                    const batchResult = await getEmbeddings(batch, "retrieval.passage");
                    results.push(...batchResult);
                    console.log(`✅ Embedded batch ${i / BATCH_SIZE + 1}:`, batch.length, 'texts');
                } catch (batchErr) {
                    console.error(`❌ Failed to embed batch ${i / BATCH_SIZE + 1}:`, batchErr);
                }
            }

            // Store embeddings in the chat store for persistence
            setRagEmbeddings(results);
            console.log(`🎉 Total embeddings loaded into store: ${results.length}`);
        } catch (err) {
            console.error('Failed to build embeddings index:', err);
        }
    };

    fetchAndEmbedTSV();
}, [getRagEmbeddings, setRagEmbeddings]);



    const {
        updateThreadItem,
        setIsGenerating,
        setAbortController,
        createThreadItem,
        setCurrentThreadItem,
        setCurrentSources,
        updateThread,
        chatMode,
        fetchRemainingCredits,
        customInstructions,
    } = useChatStore(state => ({
        updateThreadItem: state.updateThreadItem,
        setIsGenerating: state.setIsGenerating,
        setAbortController: state.setAbortController,
        createThreadItem: state.createThreadItem,
        setCurrentThreadItem: state.setCurrentThreadItem,
        setCurrentSources: state.setCurrentSources,
        updateThread: state.updateThread,
        chatMode: state.chatMode,
        fetchRemainingCredits: state.fetchRemainingCredits,
        customInstructions: "",
        // customInstructions: state.customInstructions,
    }));
    const { push } = useRouter();

    const getSelectedMCP = useMcpToolsStore(state => state.getSelectedMCP);
    const apiKeys = useApiKeysStore(state => state.getAllKeys);
    const hasApiKeyForChatMode = useApiKeysStore(state => state.hasApiKeyForChatMode);
    const setShowSignInModal = useAppStore(state => state.setShowSignInModal);

    // Fetch remaining credits when user changes
    useEffect(() => {
        fetchRemainingCredits();
    }, [user?.id, fetchRemainingCredits]);

    // In-memory store for thread items
    const threadItemMap = useMemo(() => new Map<string, ThreadItem>(), []);

    // Define common event types to reduce repetition
    const EVENT_TYPES = [
        'steps',
        'sources',
        'answer',
        'error',
        'status',
        'suggestions',
        'toolCalls',
        'toolResults',
        'object',
    ];

    // Helper: Update in-memory and store thread item
    const handleThreadItemUpdate = useCallback(
        (
            threadId: string,
            threadItemId: string,
            eventType: string,
            eventData: any,
            parentThreadItemId?: string,
            shouldPersistToDB: boolean = true
        ) => {
            // console.log(
            //     'handleThreadItemUpdate',
            //     threadItemId,
            //     eventType,
            //     eventData,
            //     shouldPersistToDB
            // );
            const prevItem = threadItemMap.get(threadItemId) || ({} as ThreadItem);
            const updatedItem: ThreadItem = {
                ...prevItem,
                query: eventData?.query || prevItem.query || '',
                mode: eventData?.mode || prevItem.mode,
                threadId,
                parentId: parentThreadItemId || prevItem.parentId,
                id: threadItemId,
                object: eventData?.object || prevItem.object,
                createdAt: prevItem.createdAt || new Date(),
                updatedAt: new Date(),
                ...(eventType === 'answer'
                    ? {
                          answer: {
                              ...eventData.answer,
                              text: (prevItem.answer?.text || '') + eventData.answer.text,
                          },
                      }
                    : { [eventType]: eventData[eventType] }),
            };

            threadItemMap.set(threadItemId, updatedItem);
            updateThreadItem(threadId, { ...updatedItem, persistToDB: true });
        },
        [threadItemMap, updateThreadItem]
    );

    const { startWorkflow, abortWorkflow } = useWorkflowWorker(
        useCallback(
            (data: any) => {
                if (
                    data?.threadId &&
                    data?.threadItemId &&
                    data.event &&
                    EVENT_TYPES.includes(data.event)
                ) {
                    handleThreadItemUpdate(
                        data.threadId,
                        data.threadItemId,
                        data.event,
                        data,
                        data.parentThreadItemId
                    );
                }

                if (data.type === 'done') {
                    setIsGenerating(false);
                    setTimeout(fetchRemainingCredits, 1000);
                    if (data?.threadItemId) {
                        threadItemMap.delete(data.threadItemId);
                    }
                }
            },
            [handleThreadItemUpdate, setIsGenerating, fetchRemainingCredits, threadItemMap]
        )
    );

    const runAgent = useCallback(
        async (body: any) => {
            const abortController = new AbortController();
            setAbortController(abortController);
            setIsGenerating(true);
            const startTime = performance.now();

            abortController.signal.addEventListener('abort', () => {
                console.info('Abort controller triggered');
                setIsGenerating(false);
                updateThreadItem(body.threadId, {
                    id: body.threadItemId,
                    status: 'ABORTED',
                    persistToDB: true,
                });
            });

            try {
                console.log("posting body", body);
                const response = await fetch('/api/completion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    credentials: 'include',
                    cache: 'no-store',
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    let errorText = await response.text();

                    if (response.status === 429 && isSignedIn) {
                        errorText =
                            'You have reached the daily limit of requests. Please try again tomorrow or Use your own API key.';
                    }

                    if (response.status === 429 && !isSignedIn) {
                        errorText =
                            'You have reached the daily limit of requests. Please sign in to enjoy more requests.';
                    }

                    setIsGenerating(false);
                    updateThreadItem(body.threadId, {
                        id: body.threadItemId,
                        status: 'ERROR',
                        error: errorText,
                        persistToDB: true,
                    });
                    console.error('Error response:', errorText);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                if (!response.body) {
                    throw new Error('No response body received');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let lastDbUpdate = Date.now();
                const DB_UPDATE_INTERVAL = 1000;
                let eventCount = 0;
                const streamStartTime = performance.now();

                let buffer = '';

                while (true) {
                    try {
                        const { value, done } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const messages = buffer.split('\n\n');
                        buffer = messages.pop() || '';

                        for (const message of messages) {
                            if (!message.trim()) continue;

                            const eventMatch = message.match(/^event: (.+)$/m);
                            const dataMatch = message.match(/^data: (.+)$/m);

                            if (eventMatch && dataMatch) {
                                const currentEvent = eventMatch[1];
                                eventCount++;

                                try {
                                    const data = JSON.parse(dataMatch[1]);
                                    if (
                                        EVENT_TYPES.includes(currentEvent) &&
                                        data?.threadId &&
                                        data?.threadItemId
                                    ) {
                                        const shouldPersistToDB =
                                            Date.now() - lastDbUpdate >= DB_UPDATE_INTERVAL;
                                        handleThreadItemUpdate(
                                            data.threadId,
                                            data.threadItemId,
                                            currentEvent,
                                            data,
                                            data.parentThreadItemId,
                                            shouldPersistToDB
                                        );
                                        if (shouldPersistToDB) {
                                            lastDbUpdate = Date.now();
                                        }
                                    } else if (currentEvent === 'done' && data.type === 'done') {
                                        setIsGenerating(false);
                                        const streamDuration = performance.now() - streamStartTime;
                                        console.log(
                                            'done event received',
                                            eventCount,
                                            `Stream duration: ${streamDuration.toFixed(2)}ms`
                                        );
                                        setTimeout(fetchRemainingCredits, 1000);
                                        if (data.threadItemId) {
                                            threadItemMap.delete(data.threadItemId);
                                        }
                                        if (data.status === 'error') {
                                            console.error('Stream error:', data.error);
                                        }
                                    }
                                } catch (jsonError) {
                                    console.warn(
                                        'JSON parse error for data:',
                                        dataMatch[1],
                                        jsonError
                                    );
                                }
                            }
                        }
                    } catch (readError) {
                        console.error('Error reading from stream:', readError);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                }
            } catch (streamError: any) {
                const totalTime = performance.now() - startTime;
                console.error(
                    'Fatal stream error:',
                    streamError,
                    `Total time: ${totalTime.toFixed(2)}ms`
                );
                setIsGenerating(false);
                if (streamError.name === 'AbortError') {
                    updateThreadItem(body.threadId, {
                        id: body.threadItemId,
                        status: 'ABORTED',
                        error: 'Generation aborted',
                    });
                } else if (streamError.message.includes('429')) {
                    updateThreadItem(body.threadId, {
                        id: body.threadItemId,
                        status: 'ERROR',
                        error: 'You have reached the daily limit of requests. Please try again tomorrow or Use your own API key.',
                    });
                } else {
                    updateThreadItem(body.threadId, {
                        id: body.threadItemId,
                        status: 'ERROR',
                        error: 'Something went wrong. Please try again.',
                    });
                }
            } finally {
                setIsGenerating(false);

                const totalTime = performance.now() - startTime;
                console.info(`Stream completed in ${totalTime.toFixed(2)}ms`);
            }
        },
        [
            setAbortController,
            setIsGenerating,
            updateThreadItem,
            handleThreadItemUpdate,
            fetchRemainingCredits,
            EVENT_TYPES,
            threadItemMap,
        ]
    );

    const handleSubmit = useCallback(
        async ({
            formData,
            newThreadId,
            existingThreadItemId,
            newChatMode,
            messages,
            useWebSearch,
            showSuggestions,
        }: {
            formData: FormData;
            newThreadId?: string;
            existingThreadItemId?: string;
            newChatMode?: string;
            messages?: ThreadItem[];
            useWebSearch?: boolean;
            showSuggestions?: boolean;
        }) => {
            const mode = (newChatMode || chatMode) as ChatMode;
            if (
                !isSignedIn &&
                !!ChatModeConfig[mode as keyof typeof ChatModeConfig]?.isAuthRequired
            ) {
                push('/sign-in');

                return;
            }

            const threadId = currentThreadId?.toString() || newThreadId;
            if (!threadId) return;

            // Update thread title
            updateThread({ id: threadId, title: formData.get('query') as string });

            const optimisticAiThreadItemId = existingThreadItemId || nanoid();
            const query = formData.get('query') as string;


            // Get query embedding and find most relevant context
            const [{ embedding: qEmb }] = await getEmbeddings([query], "retrieval.query");
            const embeddings = getRagEmbeddings();
            const withScores = embeddings
              .map((entry) => ({
                ...entry,
                score: cosineSim(qEmb, entry.embedding),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, TOP_K);
            console.log(`length of embeddings is ${withScores.length}`);
            // Store the top k documents with their scores for UI display
            const ragDocuments = withScores.map(doc => ({
                text: doc.text,
                score: doc.score
            }));

            // Create enhanced query with relevant context
            const topktexts = withScores.map(e => e.text).join('\n\n\n');
            // console.log(`query exists ${query}`);
            const ragInstructions = `
            ${RAG_INSTRUCTIONS}
            ${topktexts}
            `;
            const enhancedQuery = `
            ${query}
            ${RAG_INSTRUCTIONS}
            Here are the context passages:
            ${topktexts}
            `;



            const imageAttachment = formData.get('imageAttachment') as string;

            const aiThreadItem: ThreadItem = {
                id: optimisticAiThreadItemId,
                createdAt: new Date(),
                updatedAt: new Date(),
                status: 'QUEUED',
                threadId,
                query,
                imageAttachment,
                mode,
                ragDocuments: ragDocuments, 
            };

            createThreadItem(aiThreadItem);
            setCurrentThreadItem(aiThreadItem);
            setIsGenerating(true);
            setCurrentSources([]);

            plausible.trackEvent('send_message', {
                props: {
                    mode,
                },
            });

            // Build core messages array
            const coreMessages = buildCoreMessagesFromThreadItems({
                messages: messages || [],
                query,
                imageAttachment,
            });

            if (hasApiKeyForChatMode(mode)) {
                const abortController = new AbortController();
                setAbortController(abortController);
                setIsGenerating(true);

                abortController.signal.addEventListener('abort', () => {
                    console.info('Abort signal received');
                    setIsGenerating(false);
                    abortWorkflow();
                    updateThreadItem(threadId, { id: optimisticAiThreadItemId, status: 'ABORTED' });
                });
                console.log("starting workflow");
                startWorkflow({
                    mode,
                    question: query,
                    ragPrompt: ragInstructions,
                    threadId,
                    messages: coreMessages,
                    mcpConfig: getSelectedMCP(),
                    threadItemId: optimisticAiThreadItemId,
                    parentThreadItemId: '',
                    customInstructions,
                    apiKeys: apiKeys(),
                });
            } else {
                console.log("no api key available");
                // runAgent({
                //     mode: newChatMode || chatMode,
                //     prompt: query,
                //     threadId,
                //     messages: coreMessages,
                //     mcpConfig: getSelectedMCP(),
                //     threadItemId: optimisticAiThreadItemId,
                //     customInstructions,
                //     parentThreadItemId: '',
                //     webSearch: useWebSearch,
                //     showSuggestions: showSuggestions ?? true,
                // });
            }
        },
        [
            isSignedIn,
            currentThreadId,
            chatMode,
            setShowSignInModal,
            updateThread,
            createThreadItem,
            setCurrentThreadItem,
            setIsGenerating,
            setCurrentSources,
            abortWorkflow,
            startWorkflow,
            customInstructions,
            getSelectedMCP,
            apiKeys,
            hasApiKeyForChatMode,
            updateThreadItem,
            runAgent,
        ]
    );

    const updateContext = useCallback(
        (threadId: string, data: any) => {
            console.info('Updating context', data);
            updateThreadItem(threadId, {
                id: data.threadItemId,
                parentId: data.parentThreadItemId,
                threadId: data.threadId,
                metadata: data.context,
            });
        },
        [updateThreadItem]
    );

    const contextValue = useMemo(
        () => ({
            runAgent,
            handleSubmit,
            updateContext,
        }),
        [runAgent, handleSubmit, updateContext]
    );

    return <AgentContext.Provider value={contextValue}>{children}</AgentContext.Provider>;
};

export const useAgentStream = (): AgentContextType => {
    const context = useContext(AgentContext);
    if (!context) {
        throw new Error('useAgentStream must be used within an AgentProvider');
    }
    return context;
};
