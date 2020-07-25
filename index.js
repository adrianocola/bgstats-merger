const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const inquirerAutocomplete = require('inquirer-autocomplete-prompt')
const chalk = require('chalk');
const fuzzy = require('fuzzy');
const moment = require('moment');
const Table = require('cli-table');

inquirer.registerPrompt('autocomplete', inquirerAutocomplete);

const NEW = { name: '<new>', value: '<new>'};

const printError = (...data) => console.log(chalk.red(...data));

const readFiles = () => {
  const filePaths = _.slice(process.argv, 2);

  if (!filePaths || !filePaths.length) return console.log(chalk.whiteBright('\nUsage: bgstats-utils export1.json export2.json ... export99.json\n'));

  const files = [];
  try{
    for(const filePath of filePaths){
      const filename = path.basename(filePath);
      files.push({
        name: filename,
        path: filePath,
        data: JSON.parse(fs.readFileSync(filePath)),
      });
    }
  } catch(err) {
    console.log(err);
    printError('File not found or invalid file format...');
    return null;
  }

  return files;
};

const createNewExport = (baseData, mainPlayer) => {
  const newExport = { ...baseData };
  newExport.challenges = [];
  newExport.userInfo = {
    meRefId : mainPlayer.id,
    bggUsername: mainPlayer.bggUsername,
  };
  newExport.plays = filterPlays(newExport.plays, mainPlayer.id);
  newExport.games = filterGames(newExport.games, newExport.plays, mainPlayer.id);
  newExport.locations = filterLocations(newExport.locations, newExport.plays, mainPlayer.id);
  newExport.players = filterPlayers(newExport.players, newExport.plays, mainPlayer.id);

  return newExport;
};

const filterPlays = (plays, playerId) => {
  const filteredPlays = [];
  _.forEach(plays, (play) => {
    if (_.find(play.playerScores, ['playerRefId', playerId])) {
      filteredPlays.push(play);
    }
  })

  return filteredPlays;
};

const filterGames = (games, plays, playerId) => {
  const foundGamesIdsMap = getRelatedIdsMap(plays, playerId, 'gameRefId');
  return _.chain(games)
    .filter(game => foundGamesIdsMap[game.id])
    .map(game => {
      const newGame = { ...game };
      newGame.copies = [];
      newGame.isBaseGame = !!game.isBaseGame;
      newGame.isExpansion = !!game.isExpansion;
      return newGame;
    })
    .value();
};

const filterLocations = (locations, plays, playerId) => {
  const foundLocationsMap = getRelatedIdsMap(plays, playerId, 'locationRefId');
  return _.filter(locations, l => foundLocationsMap[l.id]);
};

const filterPlayers = (players, plays, playerId) => {
  const foundPlayersIdsMap = {};
  plays.forEach((play) => {
    if(_.some(play.playerScores, ['playerRefId', playerId])){
      play.playerScores.forEach((player) => {
        foundPlayersIdsMap[player.playerRefId] = true;
      });
    }
  });

  return _.filter(players, l => foundPlayersIdsMap[l.id]);
};

const getRelatedIdsMap = (plays, playerId, field) => {
  const foundMap = {};
  plays.forEach((play) => {
    if (play[field] && !foundMap[play[field]] && _.some(play.playerScores, ['playerRefId', playerId])) {
      foundMap[play[field]] = true;
    }
  });

  return foundMap;
};

const addItemIfNeeded = async (list, originalItem, newItem) => {
  if( typeof originalItem === 'function' ) originalItem = await originalItem(newItem);
  if(!originalItem){
    const newId = getNextId(list);
    list.push({
      ...newItem,
      id: newId,
    });
    return newId;
  }

  return originalItem.id;
};

const checkAndGetItemId = async (id, oldItem, newItem, map, list) => {
  if(map[id]){
    return map[id];
  }else{
    const originalId = await addItemIfNeeded(list, oldItem, newItem);
    map[id] = originalId;
    return originalId;
  }
}

const getNextId = collection => _.maxBy(collection, 'id').id + 1;

const selectFile = async (text, files, label) => {
  const { selectedFile } = await inquirer.prompt([{
    name: 'selectedFile',
    message: text || 'which a file?',
    type: 'list',
    choices: files.map((file, index) => ({ name: typeof label === 'function' ? label(file) : file[label] || item.path, value: index})),
  }])

  return files[selectedFile];
};

const duplicatedAction = async (text) => {
  const { action } = await inquirer.prompt([{
    name: 'action',
    message: text || 'what to do?',
    type: 'expand',
    default: 0,
    choices: [
      { key: 'i', name: 'ignore', value: 'ignore' },
      { key: 'a', name: 'add', value: 'add' },
      { key: 'r', name: 'replace', value: 'replace' },
    ],
  }])

  return action;
};

const getPlayersInfo = (oldPlay, newPlay, players) => {
  const newPlayPlayersMap = _.keyBy(newPlay.playerScores, 'playerRefId');
  const oldPlayPlayersMap = _.keyBy(oldPlay.playerScores, 'playerRefId');
  const playersScores = [];
  const isSamePlayers = _.every(newPlayPlayersMap, (player, playerId) => {
    const oldPlayer = oldPlayPlayersMap[playerId];
    if (!oldPlayer) return false;

    const playerObj = _.find(players, ['id', parseInt(playerId, 10)])
    playersScores.push([playerObj ? playerObj.name : playerId, oldPlayer.score, player.score]);
    return true;
  });
  const isSameResult = !isSamePlayers ? false : _.every(newPlayPlayersMap, (player, playerId) => {
    const oldPlayer = oldPlayPlayersMap[playerId];
    if (!oldPlayer) return false;

    return player.score === oldPlayer.score || eval(player.score) === eval(oldPlayer.score);
  });

  return { isSamePlayers, isSameResult, playersScores };
};

const selectItem = async (text, items, label, order, allowNew, options) => {
  const sortedItems = _.orderBy(items, order);
  const mappedItems = _.map(sortedItems, (item, index) => ({
    name: typeof label === 'function' ? label(item) : item[label] || item.name,
    value: index,
  }));
  const { selectedItem } = await inquirer.prompt([{
    ...options,
    name: 'selectedItem',
    message: text || 'which item?',
    type: 'autocomplete',
    source: async (answersSoFar, input) => {
      if(!input) return allowNew ? [NEW, ...mappedItems] : mappedItems;

      const fuzzyResult = fuzzy.filter(input, mappedItems, { extract: i =>  i.name });
      return _.map(fuzzyResult, r => r.original);
    },
  }])

  if(allowNew && selectedItem === NEW.value) return null;

  return sortedItems[selectedItem];
};

const run = async () => {
  const files = readFiles();

  if(!files) return;

  // select the base file
  const mainFile = await selectFile('Select main file:', files, (file) => {
    const player = _.find(file.data.players, ['id', file.data.userInfo.meRefId]);
    return `${file.name} (${player.bggUsername || player.name} - ${file.data.plays.length} plays)`;
  });
  // select the target player in the base file
  const mainPlayer = await selectItem('Select main player', mainFile.data.players, (player) => `${player.id} - ${player.name}`, 'id');

  const newExport = createNewExport(mainFile.data, mainPlayer);

  // create some indexes to speedup things
  const gamesByBggId = _.keyBy(newExport.games, 'bggId');
  const locationsByUuid = _.keyBy(newExport.locations, 'uuid');
  const playersByUuid = _.keyBy(newExport.players, 'uuid');
  const playsByUuid = _.keyBy(newExport.plays, 'uuid');
  const playsGroupedByGame = _.groupBy(newExport.plays, 'gameRefId');

  // for each file, try to mege
  for(const file of files){
    if (file === mainFile) continue;
    console.clear();

    // file to base file ids mappings
    const gamesIdsMap = {};
    const locationsIdsMap = {};
    const playersIdsMap = {};

    // create some indexes for this file
    const fileGamesById = _.keyBy(file.data.games, 'id');
    const fileLocationsById = _.keyBy(file.data.locations, 'id');
    const filePlayersById = _.keyBy(file.data.players, 'id');
    const filePlayer = _.find(file.data.players, ['id', file.data.userInfo.meRefId]);

    console.log(chalk.bold('BASE PLAYER: '), mainPlayer.bggUsername || mainPlayer.name);
    console.log(chalk.bold.inverse(`\n  ****************************************************  `));
    console.log(chalk.bold.inverse(`  PROCESSING FILE "${file.path}" (${filePlayer.bggUsername || filePlayer.name})`));
    console.log(chalk.bold.inverse(`  ****************************************************  \n`));

    // select the base player in this file
    const fileMainPlayer = await selectItem('Select matching player', file.data.players, (player) => `${player.id} - ${player.name}`, 'id', true);
    if (!fileMainPlayer) continue;

    const filteredPlays = filterPlays(file.data.plays, fileMainPlayer.id);
    const playCount = filteredPlays.length;

    // try to import each play
    for(let i = 0; i < playCount; i += 1){
      const play = filteredPlays[i];
      if (playsByUuid[play.uuid]) continue;

      const newPlay = _.cloneDeep(play);

      // check game
      const game = fileGamesById[newPlay.gameRefId];
      newPlay.gameRefId = await checkAndGetItemId(newPlay.gameRefId, gamesByBggId[game.bggId], game, gamesIdsMap, newExport.games);

      // check game
      const location = fileLocationsById[newPlay.locationRefId];
      if (location) {
        const getOriginalLocation = () => locationsByUuid[location.uuid] || selectItem(`(${i + 1}/${playCount}) Select matching location for`, newExport.locations, (location) => `${location.id} - ${location.name}`, 'id', true, {suffix: chalk.yellow(` ${location.name}`)});
        newPlay.locationRefId = await checkAndGetItemId(newPlay.locationRefId, getOriginalLocation, location, locationsIdsMap, newExport.locations);
      }

      // check players
      for(const playerScore of newPlay.playerScores){
        const player = filePlayersById[playerScore.playerRefId];
        if (player) {
          const getOriginalPlayer = () => playersByUuid[player.uuid] || selectItem(`(${i + 1}/${playCount}) Select matching player for`, newExport.players, (player) => `${player.id} - ${player.name}`, 'id', true, {suffix: chalk.yellow(` ${player.name}`)});
          playerScore.playerRefId = await checkAndGetItemId(playerScore.playerRefId, getOriginalPlayer, player, playersIdsMap, newExport.players);
        }
      }

      // try to identify duplicated plays
      const gamePlays = playsGroupedByGame[newPlay.gameRefId] || [];
      const newPlayMoment = moment(newPlay.playDate);
      let action = 'ignore';
      let duplicatedPlay = null;
      let duplicatedScores = null;
      let foundMatching = false;

      for(const gamePlay of gamePlays){
        const isSameLocation = newPlay.locationRefId === gamePlay.locationRefId;
        const isSameDay = newPlayMoment.isSame(gamePlay.playDate, 'day')
        const isSameNumberOfPlayers = newPlay.playerScores.length === gamePlay.playerScores.length;

        if(!isSameLocation || !isSameDay || !isSameNumberOfPlayers) continue;

        const { isSameResult, playersScores } = getPlayersInfo(gamePlay, newPlay, newExport.players);
        if(isSameResult) {
          foundMatching = true;
        }else{
          duplicatedPlay = gamePlay;
          duplicatedScores = playersScores;
        }
      }

      // offer to add, replace or ignore possbile duplicated play
      if(!foundMatching && duplicatedPlay){
        const table = new Table({
          head: ['Player', 'Old Play', 'New Play'],
          colWidths: [30, 30, 30],
        });
        table.push(...duplicatedScores);
        console.log(chalk.bold.red(`\n*** (${i + 1}/${playCount}) POSSIBLE DUPLICATED PLAY ***`));
        console.log(chalk.bold('GAME'), game.name);
        if (location) console.log(chalk.bold('LOCATION'), location.name);
        console.log(chalk.bold('DATE'), newPlayMoment.format('L'));
        console.log(table.toString());
        action = await duplicatedAction('Play might already exist. What to do?');

        if (action === 'add') {
          newExport.plays.push(newPlay);
          gamePlays.push(newPlay);
        } else if (action === 'replace') {
          const playsIndex = _.findIndex(newExport.plays, ['uuid', duplicatedPlay.uuid]);
          const gamePlaysIndex = _.findIndex(gamePlays, ['uuid', duplicatedPlay.uuid]);
          newExport.plays[playsIndex] = newPlay;
          gamePlays[gamePlaysIndex] = newPlay;
        }
        playsGroupedByGame[newPlay.gameRefId] = gamePlays;
      }
    }
  }

  fs.writeFileSync('./export.json', JSON.stringify(newExport, null, 2));
  console.log(chalk.green('\nSaved to file export.json\n'));
};

run();
