/*
  Trade Block: players/picks managers are open to moving.

  This site is fully static (no live backend), so there's no in-app form for
  managers to update this themselves - the same way manager bios and photos
  work elsewhere in leagueInfo.js. Whenever someone wants to update their
  block, edit the array below and upload the change the usual way.

  Format:
  {
    "managerID": "12345678",     // matches a managerID in leagueInfo.js's managers array
    "items": [
      { "player": "Name", "note": "optional short note" },
      { "pick": "2027 1st", "note": "optional short note" }
    ]
  }

  Leave items: [] (or remove the manager's whole entry) if nobody's shopping
  anything right now - the page just won't show that manager.
*/
export const tradeBlock = [
  // {
  //   "managerID": "12345678",
  //   "items": [
  //     { "player": "Example Player", "note": "will listen to offers" },
  //     { "pick": "2027 2nd", "note": "" }
  //   ]
  // },
];
