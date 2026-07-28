import React, { useEffect, useState } from 'react';
import { fetchImageBlobWithProxy } from '../utils/browserImageLoader.mjs';
import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';
import { releaseObjectURL, safeCreateObjectURL } from '../utils/urlUtils';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string;
};

const MANAGED_ASSET_PATH = '/api/assets/file/';

const AuthenticatedAssetImage: React.FC<Props> = ({ src, ...imageProps }) => {
  const [resolvedSrc, setResolvedSrc] = useState('');

  useEffect(() => {
    const sourceUrl = String(src || '').trim();
    if (!sourceUrl) {
      setResolvedSrc('');
      return undefined;
    }
    if (!sourceUrl.includes(MANAGED_ASSET_PATH)) {
      setResolvedSrc(sourceUrl);
      return undefined;
    }

    const controller = new AbortController();
    const browserUrl = resolvePublicAssetUrl(sourceUrl, '') || sourceUrl;
    let objectUrl = '';
    let disposed = false;
    setResolvedSrc('');

    void fetchImageBlobWithProxy(browserUrl, 'Managed asset image', controller.signal)
      .then((blob) => {
        if (disposed) return;
        objectUrl = safeCreateObjectURL(blob) || '';
        setResolvedSrc(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('[MEIAO] managed asset image load failed', error);
          setResolvedSrc('');
        }
      });

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) releaseObjectURL(objectUrl);
    };
  }, [src]);

  return <img {...imageProps} src={resolvedSrc || undefined} />;
};

export default AuthenticatedAssetImage;
