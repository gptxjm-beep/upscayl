import {isColorModel,isPipelineModel} from '@common/pipeline-models';
import {colorStrengthAtom,colorStyleAtom,intermediateResizeAtom} from '@/atoms/color-settings-atom';
import useJM6Labels from '@/components/hooks/use-jm6-labels';
import useTwoStageLabels from "@/components/hooks/use-two-stage-labels";
import { useTwoModelsAtom, secondModelAtom } from "@/atoms/two-stage-atom";
import getModelScale from "@common/check-model-scale";
import { selectedModelIdAtom } from "@/atoms/user-settings-atom";
import { useAtom, useAtomValue } from "jotai";
import React, { useEffect, useMemo } from "react";
import { Tooltip } from "react-tooltip";
import { themeChange } from "theme-change";
import useLogger from "../../hooks/use-logger";
import {
  savedOutputPathAtom,
  progressAtom,
  rememberOutputFolderAtom,
  scaleAtom,
  customWidthAtom,
  useCustomWidthAtom,
} from "../../../atoms/user-settings-atom";
import { FEATURE_FLAGS } from "@common/feature-flags";
import { ELECTRON_COMMANDS } from "@common/electron-commands";
import { useToast } from "@/components/ui/use-toast";
import { translationAtom } from "@/atoms/translations-atom";
import { SelectImageScale } from "../settings-tab/select-image-scale";
import SelectModelDialog from "./select-model-dialog";
import { ImageFormat } from "@/lib/valid-formats";

interface IProps {
  selectImageHandler: () => Promise<void>;
  selectFolderHandler: () => Promise<void>;
  upscaylHandler: () => Promise<void>;
  batchMode: boolean;
  setBatchMode: React.Dispatch<React.SetStateAction<boolean>>;
  imagePath: string;
  doubleUpscayl: boolean;
  setDoubleUpscayl: React.Dispatch<React.SetStateAction<boolean>>;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  setSaveImageAs: React.Dispatch<React.SetStateAction<ImageFormat>>;
  setGpuId: React.Dispatch<React.SetStateAction<string>>;
}

function UpscaylSteps({
  selectImageHandler,
  selectFolderHandler,
  upscaylHandler,
  batchMode,
  setBatchMode,
  imagePath,
  doubleUpscayl,
  setDoubleUpscayl,
  dimensions,
}: IProps) {
  const labels=useTwoStageLabels(),jm6=useJM6Labels();
  const [strength,setStrength]=useAtom(colorStrengthAtom),[style,setStyle]=useAtom(colorStyleAtom),[intermediate,setIntermediate]=useAtom(intermediateResizeAtom);
  const [useTwo,setUseTwo]=useAtom(useTwoModelsAtom);
  const first=useAtomValue(selectedModelIdAtom),second=useAtomValue(secondModelAtom);
  const color=isColorModel(first)||useTwo&&isColorModel(second),newFirst=isPipelineModel(first);
  useEffect(()=>{if(newFirst)setDoubleUpscayl(false);},[newFirst,setDoubleUpscayl]);
  const [scale, setScale] = useAtom(scaleAtom);
  const [outputPath, setOutputPath] = useAtom(savedOutputPathAtom);
  const [progress, setProgress] = useAtom(progressAtom);
  const rememberOutputFolder = useAtomValue(rememberOutputFolderAtom);
  const customWidth = useAtomValue(customWidthAtom);
  const useCustomWidth = useAtomValue(useCustomWidthAtom);

  const logit = useLogger();
  const { toast } = useToast();
  const t = useAtomValue(translationAtom);

  const outputHandler = async () => {
    const path = await window.electron.invoke(ELECTRON_COMMANDS.SELECT_FOLDER);
    if (path !== null) {
      logit("🗂 Setting Output Path: ", path);
      setOutputPath(path);
    } else {
      setOutputPath(null);
    }
  };

  useEffect(() => {
    themeChange(false);
  }, []);

  const upscaylResolution = useMemo(() => {
    const newDimensions = {
      width: dimensions.width,
      height: dimensions.height,
    };

    let doubleScale = parseInt(scale) * parseInt(scale);
    let singleScale = parseInt(scale);

    if (doubleUpscayl) {
      if (useCustomWidth) {
        newDimensions.width = customWidth;
        newDimensions.height = Math.round(
          customWidth * (dimensions.height / dimensions.width),
        );
      } else {
        const newWidth = dimensions.width * doubleScale;
        const newHeight = dimensions.height * doubleScale;
        newDimensions.width = newWidth;
        newDimensions.height = newHeight;
      }
    } else {
      if (useCustomWidth) {
        newDimensions.width = customWidth;
        newDimensions.height = Math.round(
          customWidth * (dimensions.height / dimensions.width),
        );
      } else {
        newDimensions.width = dimensions.width * singleScale;
        newDimensions.height = dimensions.height * singleScale;
      }
    }

    return newDimensions;
  }, [dimensions.width, dimensions.height, doubleUpscayl, scale]);

  return (
    <div
      className={`animate-step-in animate flex h-screen flex-col gap-7 overflow-y-auto overflow-x-hidden p-5`}
    >
      {/* BATCH OPTION */}
      <div className="flex flex-row items-center gap-2">
        <input
          type="checkbox"
          className="toggle"
          defaultChecked={batchMode}
          onClick={() => {
            if (!rememberOutputFolder) {
              setOutputPath("");
            }
            setProgress("");
            setBatchMode((oldValue) => !oldValue);
          }}
        ></input>
        <p
          className="mr-1 inline-block cursor-help text-sm"
          data-tooltip-id="tooltip"
          data-tooltip-content={t("APP.BATCH_MODE.DESCRIPTION")}
        >
          {t("APP.BATCH_MODE.TITLE")}
        </p>
      </div>

      {/* STEP 1 */}
      <div className="animate-step-in">
        <p className="step-heading">{t("APP.FILE_SELECTION.TITLE")}</p>
        <button
          className="btn btn-primary"
          onClick={!batchMode ? selectImageHandler : selectFolderHandler}
          data-tooltip-id="tooltip"
          data-tooltip-content={imagePath}
        >
          {batchMode
            ? t("APP.FILE_SELECTION.BATCH_MODE_TYPE")
            : t("APP.FILE_SELECTION.SINGLE_MODE_TYPE")}
        </button>
      </div>

      {/* STEP 2 */}
      <div className="animate-step-in group flex flex-col gap-4">
        <div>
          <p className="step-heading">{t("APP.MODEL_SELECTION.TITLE")}</p>
          <p className="mb-2 text-sm">{labels.first}</p>

          <SelectModelDialog />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox" checked={useTwo} onChange={e=>{setUseTwo(e.target.checked);if(e.target.checked)setDoubleUpscayl(false);}} />
          {labels.enable}
        </label>
        <div className={useTwo?"":"opacity-50"}>
          <p className="mb-2 text-sm">{labels.second}</p>
          <SelectModelDialog target="second" disabled={!useTwo}/>
        </div>
        {useTwo&&second&&Number(getModelScale(first))*Number(getModelScale(second))>=16&&<p role="note" className="text-xs text-warning">{labels.large}</p>}
        {useTwo&&second&&!isColorModel(first)&&!isColorModel(second)&&Number(getModelScale(second))>1&&<label className="flex flex-col gap-2 text-sm"><span className="flex items-center gap-2"><input aria-label={jm6.intermediate} type="checkbox" className="checkbox" checked={intermediate} onChange={e=>setIntermediate(e.target.checked)}/>{jm6.intermediate}</span>{intermediate&&<span className="text-xs text-warning">{jm6.intermediateNote}</span>}</label>}
        {color&&<div className="flex flex-col gap-3 rounded-xl border border-base-content/15 p-3"><p className="text-sm font-semibold">{jm6.color}</p><label className="flex flex-col gap-1 text-sm">{jm6.style}<select aria-label={jm6.style} className="select select-bordered select-sm" value={style} onChange={e=>{const value=e.target.value as 'natural'|'vivid';setStyle(value);setStrength(value==='natural'?.35:.65);}}><option value="natural">{jm6.natural}</option><option value="vivid">{jm6.vivid}</option></select></label><label className="text-sm">{jm6.strength}: {Math.round(strength*100)}%<input aria-label={jm6.strength} className="range range-sm mt-2" type="range" min="0" max="100" value={Math.round(strength*100)} onChange={e=>setStrength(Number(e.target.value)/100)}/></label><p className="text-xs text-base-content/70">{jm6.colorNote}</p><p className="text-xs text-base-content/70">{!useTwo?jm6.nativeSize:isColorModel(second)?jm6.finalBeforeColor:''}</p></div>}
        {!batchMode && (
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox"
              checked={doubleUpscayl} disabled={useTwo||newFirst}
              onChange={(e) => {
                if (e.target.checked) {
                  setDoubleUpscayl(true);
                } else {
                  setDoubleUpscayl(false);
                }
              }}
            />
            <p
              className="cursor-pointer text-sm"
              onClick={(e) => {
                if(!useTwo&&!newFirst)setDoubleUpscayl((prev) => !prev);
              }}
            >
              {t("APP.DOUBLE_UPSCAYL.TITLE")}
            </p>
            <button
              className="badge badge-neutral badge-sm cursor-help"
              data-tooltip-id="tooltip"
              data-tooltip-content={t("APP.DOUBLE_UPSCAYL.DESCRIPTION")}
            >
              ?
            </button>
          </div>
        )}

        {useTwo&&<p className="text-xs text-base-content/70">{labels.explanation}</p>}
        <SelectImageScale scale={scale} setScale={setScale} hideInfo />
      </div>

      {/* STEP 3 */}
      <div className="animate-step-in">
        <div className="flex flex-col pb-2">
          <div className="step-heading flex items-center gap-2">
            <span className="leading-none">
              {t("APP.OUTPUT_PATH_SELECTION.TITLE")}
            </span>
            {FEATURE_FLAGS.APP_STORE_BUILD && (
              <button
                className="badge badge-outline badge-sm cursor-pointer"
                onClick={() =>
                  alert(t("APP.OUTPUT_PATH_SELECTION.MAC_APP_STORE_ALERT"))
                }
              >
                ?
              </button>
            )}
          </div>
          {!outputPath && FEATURE_FLAGS.APP_STORE_BUILD && (
            <div className="text-xs">
              <span className="rounded-btn bg-base-200 px-2 font-medium uppercase text-base-content/50">
                {t("APP.OUTPUT_PATH_SELECTION.NOT_SELECTED")}
              </span>
            </div>
          )}
        </div>
        {!batchMode && !FEATURE_FLAGS.APP_STORE_BUILD && (
          <p className="mb-2 text-sm">
            {!batchMode
              ? t("APP.OUTPUT_PATH_SELECTION.DEFAULT_IMG_PATH")
              : t("APP.OUTPUT_PATH_SELECTION.DEFAULT_FOLDER_PATH")}
          </p>
        )}
        <button
          className="btn btn-primary"
          data-tooltip-content={outputPath}
          data-tooltip-id="tooltip"
          onClick={outputHandler}
        >
          {t("APP.OUTPUT_PATH_SELECTION.BUTTON_TITLE")}
        </button>
      </div>

      {/* STEP 4 */}
      <div className="animate-step-in">
        <p className="step-heading">{t("APP.SCALE_SELECTION.TITLE")}</p>
        {dimensions.width && dimensions.height && (
          <p className="mb-2 text-sm">
            {t("APP.SCALE_SELECTION.FROM_TITLE")}
            <span className="font-bold">
              {dimensions.width}x{dimensions.height}
            </span>
            {t("APP.SCALE_SELECTION.TO_TITLE")}
            <span className="font-bold">
              {upscaylResolution.width}x{upscaylResolution.height}
            </span>
          </p>
        )}
        <button
          className="btn btn-secondary"
          onClick={
            progress.length > 0 || !outputPath
              ? () =>
                  toast({
                    description: t(
                      "APP.SCALE_SELECTION.NO_OUTPUT_FOLDER_ALERT",
                    ),
                  })
              : upscaylHandler
          }
        >
          {progress.length > 0
            ? t("APP.SCALE_SELECTION.IN_PROGRESS_BUTTON_TITLE")
            : t("APP.SCALE_SELECTION.START_BUTTON_TITLE")}
        </button>
      </div>
    </div>
  );
}

export default UpscaylSteps;
