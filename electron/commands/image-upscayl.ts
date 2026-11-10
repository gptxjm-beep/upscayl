import sharp from 'sharp';
import { temporaryOutput,validateOutput,adoptOutput } from '../jobs/output';
import fs from "fs";
import { modelsPath } from "../utils/get-resource-paths";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import {
  savedCustomModelsPath,
  setChildProcesses,
  setStopped,
  stopped,
} from "../utils/config-variables";
import { getSingleImageArguments } from "../utils/get-arguments";
import logit from "../utils/logit";
import slash from "../utils/slash";
import { spawnUpscayl } from "../utils/spawn-upscayl";
import { parse } from "path";
import { getMainWindow } from "../main-window";
import { ImageUpscaylPayload } from "../../common/types/types";
import { ImageFormat } from "../types/types";
import showNotification from "../utils/show-notification";
import getFilenameFromPath from "../../common/get-file-name";
import decodePath from "../../common/decode-path";
import getDirectoryFromPath from "../../common/get-directory-from-path";
import { MODELS } from "../../common/models-list";
import { getPlatform } from "../utils/get-device-specs";
import { copyMetadata } from "../utils/copy-metadata";

const imageUpscayl = async (event, payload: ImageUpscaylPayload) => {
  const mainWindow = getMainWindow();

  if (!mainWindow) {
    logit("No main window found");
    return;
  }

  // GET VARIABLES
  const tileSize = payload.tileSize;
  const compression = payload.compression;
  const ttaMode = payload.ttaMode;
  const scale = payload.scale;
  const useCustomWidth = payload.useCustomWidth;
  const customWidth = useCustomWidth ? payload.customWidth : "";
  const model = payload.model as string;
  const gpuId = payload.gpuId as string;
  const saveImageAs = payload.saveImageAs as ImageFormat;
  const overwrite = payload.overwrite as boolean;
  const imagePath = decodePath(payload.imagePath);
  let inputDir = getDirectoryFromPath(imagePath);
  let outputDir = decodePath(payload.outputPath);
  const fileNameWithExt = getFilenameFromPath(imagePath);
  const fileName = parse(fileNameWithExt).name;

  const outFile =
    outputDir +
    slash +
    fileName +
    "_upscayl_" +
    (useCustomWidth ? `${customWidth}px_` : `${scale}x_`) +
    model +
    "." +
    saveImageAs;

  const isDefaultModel = model in MODELS;
  const sourceInfo=await sharp(imagePath,{limitInputPixels:false}).metadata().catch(error=>{mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_ERROR,String(error));return null;});
  if(!sourceInfo?.width||!sourceInfo.height)return;
  const expectedWidth=useCustomWidth?Number(customWidth):sourceInfo.width*Number(scale);
  const expectedHeight=useCustomWidth?Math.floor(sourceInfo.height*expectedWidth/sourceInfo.width):sourceInfo.height*Number(scale);
  const workFile=temporaryOutput(outFile);

  // Check if filename is too long
  if (outFile.length >= 255) {
    if (getPlatform() === "win") {
      logit("Filename too long for Windows.");
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        "The filename exceeds the maximum path length allowed by Windows. Please shorten the filename or choose a different save location.",
      );
    } else {
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_WARNING,
        "The output filename exceeds 255 characters, which is over the max path length allowed by Windows, though your OS supports it. Please consider shortening the filename next time.",
      );
    }
  }

  // UPSCALE
  if (fs.existsSync(outFile) && !overwrite) {
    // Reuse only a fully decodable output with the expected dimensions.
    try{await validateOutput(outFile,expectedWidth,expectedHeight,saveImageAs);}catch(error){mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_ERROR,String(error));return;}
    logit("✅ Already upscayled at: ", outFile);
    mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_DONE, outFile);
  } else {
    logit(
      "✅ Upscayl Variables: ",
      JSON.stringify({
        model,
        gpuId,
        saveImageAs,
        inputDir,
        fileNameWithExt,
        outputDir,
        outFile,
        fileName,
        scale,
        compression,
        customWidth,
        useCustomWidth,
        tileSize,
      }),
    );
    const upscayl = spawnUpscayl(
      getSingleImageArguments({
        inputDir: decodeURIComponent(inputDir),
        fileNameWithExt: decodeURIComponent(fileNameWithExt),
        outFile:workFile,
        modelsPath: isDefaultModel
          ? modelsPath
          : (savedCustomModelsPath ?? modelsPath),
        model,
        scale,
        gpuId,
        saveImageAs,
        customWidth,
        compression,
        tileSize,
        ttaMode,
      }),
      logit,
      true,
    );

    setChildProcesses(upscayl);

    setStopped(false);
    let failed = false;

    const onData = (data: string) => {
      logit(data.toString());
      mainWindow.setProgressBar(parseFloat(data.slice(0, data.length)) / 100);
      data = data.toString();
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_PROGRESS,
        data.toString(),
      );
      if (data.includes("Error") || data.includes("failed")) {
        upscayl.kill();
        failed = true;
        onError(data);
      } else if (data.includes("Resizing")) {
        mainWindow.webContents.send(ELECTRON_COMMANDS.SCALING_AND_CONVERTING);
      }
    };
    const onError = (data) => {
      if (!mainWindow) return;
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send(
        ELECTRON_COMMANDS.UPSCAYL_ERROR,
        data.toString(),
      );
      failed = true;
      upscayl.kill();
      return;
    };
    const onClose = async (code:number|null,signal:string|null) => {
      try{
        if(stopped){mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_PROGRESS,'');return;}
        if(failed)return;
        if(code!==0||signal)throw Error(`Processing engine exited with code ${code}, signal ${signal||'none'}.`);
        if(payload.copyMetadata)await copyMetadata(imagePath,workFile);
        await validateOutput(workFile,expectedWidth,expectedHeight,saveImageAs);
        adoptOutput(workFile,outFile,overwrite);
        mainWindow.setProgressBar(-1);
        mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_DONE,outFile);
        showNotification('Upscayl','Image upscayled successfully!');
      }catch(error){mainWindow.setProgressBar(-1);mainWindow.webContents.send(ELECTRON_COMMANDS.UPSCAYL_ERROR,String(error));}
      finally{try{fs.rmSync(workFile,{force:true});}catch(error){logit('Temporary output cleanup failed',String(error));}}
    };

    upscayl.process.stderr.on("data", onData);
    upscayl.process.on("error", onError);
    upscayl.process.on("close", onClose);
  }
};

export default imageUpscayl;
