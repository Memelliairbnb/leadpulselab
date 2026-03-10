'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Duration = 10 | 30;
type MusicGenre = 'dramatic' | 'hiphop' | 'dark' | 'pop';

export default function NewVideoPage() {
  const router = useRouter();
  const [duration, setDuration] = useState<Duration>(10);
  const [musicGenre, setMusicGenre] = useState<MusicGenre>('dramatic');
  const [files, setFiles] = useState<(File | null)[]>([null]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const clipCount = duration === 10 ? 1 : 3;

  function handleDurationChange(newDuration: Duration) {
    setDuration(newDuration);
    if (newDuration === 10) {
      setFiles([files[0] ?? null]);
    } else {
      setFiles([files[0] ?? null, null, null]);
    }
  }

  function handleFileChange(index: number, file: File | null) {
    setFiles((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validFiles = files.filter((f): f is File => f !== null);
    if (validFiles.length !== clipCount) {
      setError(`Please select ${clipCount} file${clipCount > 1 ? 's' : ''}`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('duration', String(duration));
      formData.append('music_genre', musicGenre);
      validFiles.forEach((file, i) => {
        formData.append(`clip_${i}`, file);
      });

      // Use XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/proxy/upload?target=video/process');

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error || `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

        xhr.send(formData);
      });

      router.push('/video');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/video" className="text-xs text-text-muted hover:text-text-secondary transition-colors">
          &larr; Back to Video
        </Link>
        <h1 className="text-lg font-semibold text-text-primary mt-2">Process New Video</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Upload clips and configure video processing settings
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Duration Selector */}
        <div className="bg-surface-raised border border-border rounded-lg p-5 space-y-3">
          <label className="block text-sm font-medium text-text-primary">Duration</label>
          <p className="text-xs text-text-muted">Choose the length of the final video</p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <button
              type="button"
              onClick={() => handleDurationChange(10)}
              className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                duration === 10
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface-overlay text-text-secondary hover:border-accent/40'
              }`}
            >
              <span className="block text-lg font-semibold tabular-nums">10s</span>
              <span className="block text-xs mt-0.5 opacity-70">1 clip</span>
            </button>
            <button
              type="button"
              onClick={() => handleDurationChange(30)}
              className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                duration === 30
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface-overlay text-text-secondary hover:border-accent/40'
              }`}
            >
              <span className="block text-lg font-semibold tabular-nums">30s</span>
              <span className="block text-xs mt-0.5 opacity-70">3 clips</span>
            </button>
          </div>
        </div>

        {/* File Uploads */}
        <div className="bg-surface-raised border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary">Upload Clips</label>
            <p className="text-xs text-text-muted mt-0.5">
              {clipCount === 1 ? 'Select 1 video or image file' : `Select ${clipCount} video or image files`}
            </p>
          </div>

          {Array.from({ length: clipCount }).map((_, index) => (
            <div key={index} className="space-y-1">
              {clipCount > 1 && (
                <label className="block text-xs text-text-muted font-medium">
                  Clip {index + 1}
                </label>
              )}
              <div
                onClick={() => fileInputRefs.current[index]?.click()}
                className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  files[index]
                    ? 'border-accent/40 bg-accent/5'
                    : 'border-border hover:border-accent/30 hover:bg-surface-overlay'
                }`}
              >
                <input
                  ref={(el) => { fileInputRefs.current[index] = el; }}
                  type="file"
                  accept="video/*,image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(index, e.target.files?.[0] ?? null)}
                />
                {files[index] ? (
                  <div className="flex items-center justify-center gap-3">
                    <svg className="w-5 h-5 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-left">
                      <p className="text-sm text-text-primary font-medium truncate max-w-xs">
                        {files[index]!.name}
                      </p>
                      <p className="text-xs text-text-muted">{formatFileSize(files[index]!.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileChange(index, null);
                        if (fileInputRefs.current[index]) {
                          fileInputRefs.current[index]!.value = '';
                        }
                      }}
                      className="ml-2 text-text-muted hover:text-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div>
                    <svg className="w-8 h-8 mx-auto text-text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-text-secondary">Click to select a file</p>
                    <p className="text-xs text-text-muted mt-1">Video or image</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Music Genre */}
        <div className="bg-surface-raised border border-border rounded-lg p-5 space-y-3">
          <label className="block text-sm font-medium text-text-primary">Music Genre</label>
          <p className="text-xs text-text-muted">Select the background music style</p>
          <select
            value={musicGenre}
            onChange={(e) => setMusicGenre(e.target.value as MusicGenre)}
            className="w-full mt-2 px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
          >
            <option value="dramatic">Dramatic</option>
            <option value="hiphop">Hip Hop</option>
            <option value="dark">Dark</option>
            <option value="pop">Pop</option>
          </select>
        </div>

        {/* Upload Progress */}
        {uploading && (
          <div className="bg-surface-raised border border-border rounded-lg p-5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">Uploading...</span>
              <span className="text-text-primary font-medium tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 bg-surface-overlay rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={uploading}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
          >
            {uploading ? 'Uploading...' : 'Start Processing'}
          </button>
          <Link
            href="/video"
            className="px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
