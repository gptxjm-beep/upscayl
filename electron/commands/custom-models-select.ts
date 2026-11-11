import { dialog } from "electron";
import {
  savedCustomModelsPath,
  setSavedCustomModelsPath,
} from "../utils/config-variables";
import logit from "../utils/logit";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import getModels from "../utils/get-models";
import { getMainWindow } from "../main-window";
import settings from "electron-settings";
import { FEATURE_FLAGS } from "../../common/feature-flags";

const customModelsSelect = async (event, message) => {
  const mainWindow = getMainWindow();

  if (!mainWindow) return;
  const {
    canceled,
    filePaths: folderPaths,
    bookmarks,
  } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Custom Models Folder",
    defaultPath: savedCustomModelsPath,
    securityScopedBookmarks: true,
    message: "Select the models folder from your extracted model package",
  });

  if (canceled) {
    logit("🚫 Select Custom Models Folder Operation Cancelled");
    return null;
  } else {
    const models = await getModels(folderPaths[0]);
    if(!models.length){
      dialog.showMessageBoxSync({type:'error',title:'No supported models',message:'The selected folder contains no complete, verified model imports. Extract the model package and select its models folder. Your previous folder is unchanged.',buttons:['OK']});
      return null;
    }
    setSavedCustomModelsPath(folderPaths[0]);
  if (FEATURE_FLAGS.APP_STORE_BUILD && bookmarks && bookmarks.length > 0) {
    console.log("🚨 Setting Bookmark: ", bookmarks);
    await settings.set("custom-models-bookmarks", bookmarks[0]);
  }

    mainWindow.webContents.send(
      ELECTRON_COMMANDS.CUSTOM_MODEL_FILES_LIST,
      models,
    );

    logit("📁 Custom Folder Path: ", savedCustomModelsPath);
    return savedCustomModelsPath;
  }
};

export default customModelsSelect;
