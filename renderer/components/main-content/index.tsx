"use client";
import useLogger from "../hooks/use-logger";
import { useState, useMemo, useEffect, useRef } from "react";
import { ELECTRON_COMMANDS } from "@common/electron-commands";
import { useAtom, useAtomValue } from "jotai";
import {
  batchModeAtom,
  lensSizeAtom,
  savedOutputPathAtom,
  progressAtom,
  viewTypeAtom,
  rememberOutputFolderAtom,
} from "../../atoms/user-settings-atom";
import { useToast } from "@/components/ui/use-toast";
import { sanitizePath } from "@common/sanitize-path";
import getDirectoryFromPath from "@common/get-directory-from-path";
import { FEATURE_FLAGS } from "@common/feature-flags";
import { ImageFormat, VALID_IMAGE_FORMATS } from "@/lib/valid-formats";
import ProgressBar from "./progress-bar";
import InstructionsCard from "./instructions-card";
import MoreOptionsDrawer from "./more-options-drawer";
import useUpscaylVersion from "../hooks/use-upscayl-version";
import MacTitlebarDragRegion from "./mac-titlebar-drag-region";
import LensViewer from "./lens-view";
import ImageViewer from "./image-viewer";
import useTranslation from "../hooks/use-translation";
import SliderView from "./slider-view";

type MainContentProps = {
  imagePath: string;
  resetImagePaths: () => void;
  upscaledBatchFolderPath: string;
  setImagePath: React.Dispatch<React.SetStateAction<string>>;
  validateImagePath: (path: string) => void;
  selectFolderHandler: () => void;
  selectImageHandler: () => void;
  upscaledImagePath: string;
  batchFolderPath: string;
  doubleUpscaylCounter: number;
  setDimensions: React.Dispatch<
    React.SetStateAction<{
      width: number;
      height: number;
    }>
  >;
};

const MainContent = ({
  imagePath,
  resetImagePaths,
  upscaledBatchFolderPath,
  setImagePath,
  validateImagePath,
  selectFolderHandler,
  selectImageHandler,
  upscaledImagePath,
  batchFolderPath,
  doubleUpscaylCounter,
  setDimensions,
}: MainContentProps) => {
  const t = useTranslation();
  const logit = useLogger();
  const { toast } = useToast();
  const version = useUpscaylVersion();

  const [outputPath, setOutputPath] = useAtom(savedOutputPathAtom);
  const progress = useAtomValue(progressAtom);
  const [batchMode,setBatchMode] = useAtom(batchModeAtom);
  const opening=useRef(false);
  const [openingImage,setOpeningImage]=useState(false);

  const viewType = useAtomValue(viewTypeAtom);
  const lensSize = useAtomValue(lensSizeAtom);
  const rememberOutputFolder = useAtomValue(rememberOutputFolderAtom);
  const [zoomAmount, setZoomAmount] = useState("100");

  const sanitizedUpscaledImagePath = useMemo(
    () => sanitizePath(upscaledImagePath),
    [upscaledImagePath],
  );

  const showInformationCard = useMemo(() => {
    if (!batchMode) {
      return imagePath.length === 0 && upscaledImagePath.length === 0;
    } else {
      return (
        batchFolderPath.length === 0 && upscaledBatchFolderPath.length === 0
      );
    }
  }, [
    batchMode,
    imagePath,
    upscaledImagePath,
    batchFolderPath,
    upscaledBatchFolderPath,
  ]);

  // DRAG AND DROP HANDLERS
  const handleDragEnter = (e) => {
    e.preventDefault();
    console.log("drag enter");
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    console.log("drag leave");
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    console.log("drag over");
  };

  const openFolderHandler = (e) => {
    const logit = useLogger();
    logit("📂 OPEN_FOLDER: ", upscaledBatchFolderPath);
    window.electron.send(
      ELECTRON_COMMANDS.OPEN_FOLDER,
      upscaledBatchFolderPath,
    );
  };

  const sanitizedImagePath = useMemo(
    () => sanitizePath(imagePath),
    [imagePath],
  );

  const handleDrop = async (e:React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();e.stopPropagation();
    if(progress||opening.current)return;
    const file=e.dataTransfer.files?.[0];
    if(!file){toast({title:t('INPUT_DROP.TITLE'),description:t('INPUT_DROP.LOCAL_ONLY')});return;}
    const filePath=window.electron.getPathForFile(file);
    if(!filePath){logit('Drop rejected: Electron webUtils returned no local path');toast({title:t('INPUT_DROP.TITLE'),description:t('INPUT_DROP.LOCAL_ONLY')});return;}
    opening.current=true;setOpeningImage(true);
    try{
      // MIME may legitimately be empty. Main verifies bytes and filesystem access.
      const result=await window.electron.invoke(ELECTRON_COMMANDS.VALIDATE_INPUT_IMAGE,filePath);
      if(!result?.ok){logit('Drop rejected',result?.code);toast({title:t('INPUT_DROP.TITLE'),description:t('INPUT_DROP.INVALID')});return;}
      resetImagePaths();setBatchMode(false);setImagePath(result.path);
      setDimensions({width:result.width,height:result.height});
      if(!FEATURE_FLAGS.APP_STORE_BUILD&&!rememberOutputFolder)setOutputPath(getDirectoryFromPath(result.path));
      logit('Dropped image opened using Electron webUtils');
    }catch(error){logit('Drop failed',String(error));toast({title:t('INPUT_DROP.TITLE'),description:t('INPUT_DROP.INVALID')});}
    finally{opening.current=false;setOpeningImage(false);}
  };

  useEffect(()=>{
    const prevent=(event:DragEvent)=>{
      event.preventDefault();
      if(event.type==='drop'&&!(event.target as Element)?.closest?.('[data-upscayl-drop-zone]')){
        logit('Drop outside preview ignored; navigation prevented');
        toast({title:t('INPUT_DROP.TITLE'),description:t('INPUT_DROP.PREVIEW_ONLY')});
      }
    };
    window.addEventListener('dragover',prevent);window.addEventListener('drop',prevent);
    return()=>{window.removeEventListener('dragover',prevent);window.removeEventListener('drop',prevent);};
  },[logit,toast,t]);

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (outputPath) {
      resetImagePaths();
      if (e.clipboardData.files.length) {
        const fileObject = e.clipboardData.files[0];
        const currentDate = new Date(Date.now());
        const currentTime = `${currentDate.getHours()}-${currentDate.getMinutes()}-${currentDate.getSeconds()}`;
        const fileName = `.temp-${currentTime}-${fileObject.name || "image"}`;
        const file = {
          name: fileName,
          path: outputPath,
          extension: fileName.split(".").pop() as ImageFormat,
          size: fileObject.size,
          type: fileObject.type.split("/")[0],
          encodedBuffer: "",
        };

        logit(
          "📋 Pasted file: ",
          JSON.stringify({
            name: file.name,
            path: file.path,
            extension: file.extension,
          }),
        );

        if (
          file.type === "image" &&
          VALID_IMAGE_FORMATS.includes(file.extension)
        ) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const result = event.target?.result;
            if (typeof result === "string") {
              file.encodedBuffer = Buffer.from(result, "utf-8").toString(
                "base64",
              );
            } else if (result instanceof ArrayBuffer) {
              file.encodedBuffer = Buffer.from(new Uint8Array(result)).toString(
                "base64",
              );
            } else {
              logit("🚫 Invalid file pasted");
              toast({
                title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
                description: t(
                  "ERRORS.INVALID_IMAGE_ERROR.CLIPBOARD_DESCRIPTION",
                ),
              });
            }
            window.electron.send(ELECTRON_COMMANDS.PASTE_IMAGE, file);
          };
          reader.readAsArrayBuffer(fileObject);
        } else {
          logit("🚫 Invalid file pasted");
          toast({
            title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
            description: t("ERRORS.INVALID_IMAGE_ERROR.CLIPBOARD_DESCRIPTION"),
          });
        }
      } else {
        logit("🚫 Invalid file pasted");
        toast({
          title: t("ERRORS.INVALID_IMAGE_ERROR.TITLE"),
          description: t("ERRORS.INVALID_IMAGE_ERROR.CLIPBOARD_DESCRIPTION"),
        });
      }
    } else {
      toast({
        title: t("ERRORS.NO_OUTPUT_FOLDER_ERROR.TITLE"),
        description: t("ERRORS.NO_OUTPUT_FOLDER_ERROR.DESCRIPTION"),
      });
    }
  };

  useEffect(() => {
    // Events
    const handlePasteEvent = (e) => handlePaste(e);
    const handlePasteImageSaveSuccess = (_: any, imageFilePath: string) => {
      setImagePath(imageFilePath);
      validateImagePath(imageFilePath);
    };
    const handlePasteImageSaveError = (_: any, error: string) => {
      toast({
        title: t("ERRORS.NO_IMAGE_ERROR.TITLE"),
        description: error,
      });
    };
    window.addEventListener("paste", handlePasteEvent);
    window.electron.on(
      ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_SUCCESS,
      handlePasteImageSaveSuccess,
    );
    window.electron.on(
      ELECTRON_COMMANDS.PASTE_IMAGE_SAVE_ERROR,
      handlePasteImageSaveError,
    );
    return () => {
      window.removeEventListener("paste", handlePasteEvent);
    };
  }, [t, outputPath]);

  return (
    <div
      className="relative flex h-screen w-full flex-col items-center justify-center"
      data-upscayl-drop-zone
      aria-busy={openingImage}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDoubleClick={batchMode ? selectFolderHandler : selectImageHandler}
    >
      {openingImage&&<p role="status" className="absolute right-4 top-4 z-50 rounded-xl bg-base-200 px-4 py-2 text-sm">{t('INPUT_DROP.OPENING')}</p>}
      <MacTitlebarDragRegion />

      {progress.length > 0 &&
        upscaledImagePath.length === 0 &&
        upscaledBatchFolderPath.length === 0 && (
          <ProgressBar
            batchMode={batchMode}
            progress={progress}
            doubleUpscaylCounter={doubleUpscaylCounter}
            resetImagePaths={resetImagePaths}
          />
        )}

      {/* DEFAULT PANE INFO */}
      {showInformationCard && (
        <InstructionsCard version={version} batchMode={batchMode} />
      )}

      <MoreOptionsDrawer
        zoomAmount={zoomAmount}
        setZoomAmount={setZoomAmount}
        resetImagePaths={resetImagePaths}
      />

      {/* SHOW SELECTED IMAGE */}
      {!batchMode && upscaledImagePath.length === 0 && imagePath.length > 0 && (
        <ImageViewer imagePath={imagePath} setDimensions={setDimensions} />
      )}

      {/* BATCH UPSCALE SHOW SELECTED FOLDER */}
      {batchMode &&
        upscaledBatchFolderPath.length === 0 &&
        batchFolderPath.length > 0 && (
          <p className="select-none text-base-content">
            <span className="font-bold">
              {t("APP.PROGRESS.BATCH.SELECTED_FOLDER_TITLE")}
            </span>{" "}
            {batchFolderPath}
          </p>
        )}
      {/* BATCH UPSCALE DONE INFO */}

      {batchMode && upscaledBatchFolderPath.length > 0 && (
        <div className="z-50 flex flex-col items-center">
          <p className="select-none py-4 font-bold text-base-content">
            {t("APP.PROGRESS.BATCH.DONE_TITLE")}
          </p>
          <button
            className="bg-gradient-blue btn btn-primary rounded-btn p-3 font-medium text-white/90 transition-colors"
            onClick={openFolderHandler}
          >
            {t("APP.PROGRESS.BATCH.OPEN_UPSCAYLED_FOLDER_TITLE")}
          </button>
        </div>
      )}

      {!batchMode && viewType === "lens" && upscaledImagePath && imagePath && (
        <LensViewer
          sanitizedImagePath={sanitizedImagePath}
          sanitizedUpscaledImagePath={sanitizedUpscaledImagePath}
        />
      )}

      {/* COMPARISON SLIDER */}
      {!batchMode &&
        viewType === "slider" &&
        imagePath.length > 0 &&
        upscaledImagePath.length > 0 && (
          <SliderView
            sanitizedImagePath={sanitizedImagePath}
            sanitizedUpscaledImagePath={sanitizedUpscaledImagePath}
            zoomAmount={zoomAmount}
          />
        )}
    </div>
  );
};

export default MainContent;
