import path from 'path';
import { verifiedOptionalModel } from '../jobs/model-files';
import fs from "fs";
import logit from "./logit";
import { MessageBoxOptions, app, dialog } from "electron";
import settings from "electron-settings";
import { FEATURE_FLAGS } from "../../common/feature-flags";

const getModels = async (folderPath: string | undefined) => {
  let models: string[] = [];
  let isValid = false;

  // SECURITY SCOPED BOOKMARKS
  let closeAccess;
  const customModelsBookmarks = await settings.get("custom-models-bookmarks");
  if (FEATURE_FLAGS.APP_STORE_BUILD && customModelsBookmarks) {
    console.log(
      "🚀 => file: get-models.ts:18 => customModelsBookmarks:",
      customModelsBookmarks,
    );
    try {
      closeAccess = app.startAccessingSecurityScopedResource(
        customModelsBookmarks as string,
      );
    } catch (error) {
      logit("📁 Custom Models Bookmarks Error: ", error);
    }
  }

  if (!folderPath) {
    logit("❌ Invalid Custom Model Folder Detected");
    const options: MessageBoxOptions = {
      type: "error",
      title: "Invalid Folder",
      message:
        "The selected folder does not contain valid model files. Make sure you select the folder that ONLY contains '.param' and '.bin' files.",
      buttons: ["OK"],
    };
    dialog.showMessageBoxSync(options);
    return null;
  }

  // READ CUSTOM MODELS FOLDER
  fs.readdirSync(folderPath).forEach((file) => {
    // log.log("Files in Folder: ", file);
    if (
      file.endsWith(".param") ||
      file.endsWith(".PARAM") ||
      file.endsWith(".bin") ||
      file.endsWith(".BIN")
    ) {
      isValid = true;
      const modelName = file.substring(0, file.lastIndexOf(".")) || file;
      if (!models.includes(modelName)) {
        models.push(modelName);
      }
    }
  });

  if (!isValid) {
    logit("❌ Invalid Custom Model Folder Detected");
    const options: MessageBoxOptions = {
      type: "error",
      title: "Invalid Folder",
      message:
        "The selected folder does not contain valid model files. Make sure you select the folder that ONLY contains '.param' and '.bin' files.",
      buttons: ["OK"],
    };
    dialog.showMessageBoxSync(options);
    return null;
  }

  const accepted:string[]=[];
  for(const id of models){
    if(!fs.existsSync(path.join(folderPath,id+'.param'))||!fs.existsSync(path.join(folderPath,id+'.bin')))continue;
    try{await verifiedOptionalModel(folderPath,id);accepted.push(id);}catch(error){logit('Optional model unavailable',String(error));}
  }
  models=accepted;
  logit("🔎 Detected Custom Models: ", models);
  return models;
};

export default getModels;
