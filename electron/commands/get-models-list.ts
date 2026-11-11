import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import { getMainWindow } from "../main-window";
import {
  savedCustomModelsPath,
  setSavedCustomModelsPath,
} from "../utils/config-variables";
import getModels from "../utils/get-models";
import logit from "../utils/logit";

const getModelsList = async (event, payload) => {
  const mainWindow = getMainWindow();

  if (!mainWindow) return;
  if (payload) {
    if(typeof payload!=='string')return;

    logit("📁 Custom Models Folder Path: ", savedCustomModelsPath);
    const models = await getModels(payload);
    if(models.length)setSavedCustomModelsPath(payload);

    mainWindow.webContents.send(
      ELECTRON_COMMANDS.CUSTOM_MODEL_FILES_LIST,
      models,
    );
  }
};

export default getModelsList;
