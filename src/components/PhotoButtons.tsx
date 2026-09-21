import { Camera, ImagePlus } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { primaryBtn, quietBtn } from "../theme";

interface Props {
  onFile: (file: File) => void;
  cameraLabel: string;
}

/** Take a photo with the rear camera, or pick one from the photo library. */
export function PhotoButtons({ onFile, cameraLabel }: Props) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onFile(f);
  };
  return (
    <div className="flex flex-col gap-3">
      <input ref={cam} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
      <input ref={lib} type="file" accept="image/*" onChange={pick} className="hidden" />
      <button className="pf-btn" style={primaryBtn} onClick={() => cam.current?.click()}>
        <Camera size={20} /> {cameraLabel}
      </button>
      <button className="pf-btn" style={quietBtn} onClick={() => lib.current?.click()}>
        <ImagePlus size={20} /> Choose from photos
      </button>
    </div>
  );
}
