### BGStats merger

Simple node.js script to merge BGStats exports into a single file. Very useful if a new player wants to start using BGStats and wants to get the plays from other users.

The script allows you to: 

- Select the "me" player;
- Select and match players, locations and games;  
- Identify possible duplicates (same play registered by different users);
- Choose to ignore, add or replace duplicated plays;

Usage:

```bash
    git clone https://github.com/adrianocola/bgstats-merger
    cd bgstats-merger
    npm install
    node index <export1.json> <export2.json> ... <export99.json>
```
