import React, { useState, useEffect } from 'react';
import { m } from 'framer-motion';
import { Ghost, Home, RefreshCw } from 'lucide-react';

interface MemeData {
    title: string;
    url: string;
    postLink: string;
    subreddit: string;
}

export const NotFoundPage: React.FC = () => {
    const [meme, setMeme] = useState<MemeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchMeme = async () => {
        setLoading(true);
        setError(false);
        try {
            // Use meme-api.com for random memes (SFW subreddits)
            const res = await fetch('https://meme-api.com/gimme/memes');
            if (res.ok) {
                const data = await res.json();
                setMeme({
                    title: data.title,
                    url: data.url,
                    postLink: data.postLink,
                    subreddit: data.subreddit,
                });
            } else {
                setError(true);
            }
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMeme();
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">

            {/* Background Ambient */}
            <div className="absolute top-1/4 -left-20 w-[60vw] h-[50vh] fx-glow text-violet-500/10 -z-10" />
            <div className="absolute bottom-1/4 -right-20 w-[70vw] h-[60vh] fx-glow text-cyan-500/10 -z-10" />

            <m.div
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="glass-card p-8 sm:p-12 max-w-2xl w-full text-center space-y-8 relative z-10"
            >
                {/* Header */}
                <div className="space-y-4">
                    <m.div
                        animate={{
                            y: [0, -10, 0],
                            rotate: [0, 5, -5, 0]
                        }}
                        transition={{
                            duration: 3,
                            repeat: Infinity,
                            ease: 'easeInOut'
                        }}
                    >
                        <Ghost className="w-20 h-20 sm:w-24 sm:h-24 text-violet-500 dark:text-neural-violet mx-auto" />
                    </m.div>

                    <h1 className="text-6xl sm:text-8xl font-black text-gray-900 dark:text-white tracking-tighter">
                        4<span className="text-violet-500 dark:text-neural-violet">0</span>4
                    </h1>

                    <p className="text-gray-500 dark:text-white/40 text-sm sm:text-base uppercase tracking-[0.3em] font-bold">
                        頁面不存在或存取受限
                    </p>
                </div>

                {/* Meme Section */}
                <div className="space-y-4">
                    {loading ? (
                        <div className="h-64 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="h-64 flex items-center justify-center text-gray-400 dark:text-white/30">
                            <p>無法載入梗圖，請重試</p>
                        </div>
                    ) : meme && (
                        <m.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="space-y-3"
                        >
                            <div className="relative rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5">
                                <img
                                    src={meme.url}
                                    alt={meme.title}
                                    className="w-full max-h-100 object-contain"
                                    loading="lazy"
                                />
                            </div>
                            <p className="text-xs text-gray-400 dark:text-white/30 font-medium truncate px-4">
                                {meme.title} • r/{meme.subreddit}
                            </p>
                        </m.div>
                    )}

                    <button
                        onClick={fetchMeme}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-neural-violet hover:bg-violet-50 dark:hover:bg-neural-violet/10 rounded-xl transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        換一張
                    </button>
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-gray-200 dark:border-white/10">
                    <a
                        href="/"
                        className="inline-flex items-center gap-3 px-6 py-3 bg-violet-100 dark:bg-neural-violet/10 border border-violet-200 dark:border-neural-violet/30 rounded-2xl text-violet-700 dark:text-neural-violet font-bold uppercase tracking-widest text-sm hover:bg-violet-200 dark:hover:bg-neural-violet/20 transition-all shadow-lg"
                    >
                        <Home className="w-5 h-5" />
                        返回首頁
                    </a>
                </div>
            </m.div>
        </div>
    );
};
