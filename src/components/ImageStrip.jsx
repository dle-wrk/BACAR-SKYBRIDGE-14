import { Image as ImageIcon } from 'lucide-react';
import { Image } from '@/components/ui/image';

// nRF-relayed image thumbnails for a cube.
export default function ImageStrip({ images }) {
  if (!images || images.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-6 text-center">
        <ImageIcon className="w-6 h-6 mx-auto mb-2 text-muted-foreground opacity-40" />
        <p className="text-sm text-muted-foreground">No nRF images received yet</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {images.map((img, i) => (
        <div key={img.t + '' + i} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-border/60 group">
          <Image src={img.url} alt={`nRF frame ${i + 1}`} className="w-full h-full" fittingType="fill" />
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
            <span className="font-mono text-[9px] text-white/80">
              {new Date(img.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}