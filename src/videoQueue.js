// setup 
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const http = require('https');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
app.use(express.static('templates'));
app.set("views", path.resolve(__dirname, "templates"));
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: false }));
require("dotenv").config({ path: path.resolve(__dirname, 'credentialsDontPost/.env') })  


const portNumber = 4000;

const collectionUsers = "videoUsers";
const collectionQueue = "videoQueue";
const database = "CMSC335DB";
const uri = process.env.MONGO_CONNECTION_STRING;

videos = [];
user = "";

// display 
app.get('/', (req, res) => {
  res.render('login', { videos });
});

// server start
app.listen(portNumber, () => {
  console.log(`Server running on port ${portNumber}`);
});


app.post("/add-video", async (request, response) => {
  const { url, notes } = request.body;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(database);
    let videoID = url.substring(32).split('&')[0];

    const options = {
      method: 'GET',
      hostname: 'yt-api.p.rapidapi.com',
      port: null,
      path: `/video/info?id=${videoID}`,
      headers: {
          'x-rapidapi-key': 'aac9cd5f76msh9b9408f185c9ae5p16941bjsn4142afbda16c',
          'x-rapidapi-host': 'yt-api.p.rapidapi.com'
      }
  };

    const req = http.request(options, (res) => {
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));

      res.on("end", async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const lengthInSeconds = body.lengthSeconds || "Unknown";
          const viewCount = body.viewCount || "Unknown";
          const videoTitle = body.title || "Unknown Title";
          const videoCreator = body.channelTitle || "Unknown Creator";
          const thumbnailURL =
            (body.thumbnail && body.thumbnail[0]?.url) ||
            "https://via.placeholder.com/150";

          if (lengthInSeconds === "Unknown" || viewCount === "Unknown") {
            console.error("Error: Missing video details in API response.");
            return response.status(500).send("Failed to fetch video details.");
          }

          await db.collection(collectionQueue).insertOne({
            url,
            notes,
            length: parseInt(lengthInSeconds, 10),
            views: parseInt(viewCount, 10),
            title: videoTitle,
            creator: videoCreator,
            thumbnail: thumbnailURL,
            user: user
          });

          videos = await db.collection(collectionQueue).find({ user }).toArray();
          response.render("index", { user, videos });
        } catch (err) {
          console.error("Error parsing API response:", err);
          response.status(500).send("Error fetching video details.");
        } finally {
          await client.close();
        }
      });
    });

    req.on("error", (err) => {
      console.error("HTTP Request Error:", err);
      response.status(500).send("Error fetching video details.");
    });

    req.end();
  } catch (err) {
    console.error("Database Error:", err);
    response.status(500).send("Internal server error.");
  }
});



app.post("/index", async (request, response) => {
  const { username } = request.body;
  if (!username) {
    return response.status(400).send("Username is required");
  } 

  const client = new MongoClient(uri, {serverApi: ServerApiVersion.v1 });

  try {
    await client.connect();
    const db = client.db(database);
    let result = await db.collection(collectionUsers).findOne({ username });
    
    if (!result) {
      result = await db.collection(collectionUsers).insertOne({
        username,
        secondsQueued: 0,
        videosWatched: 0,
        longestVideoWatchedLength: 0,
        longestVideoWatched: ""
      });
    }

    videos = await db.collection(collectionQueue).find({ user: username }).toArray();
    user = username;

    response.render("index", { user: result, videos});
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
});

app.get('/index', (req, res) => {
  res.render('index');
});


app.get('/login', (req, res) => {
  res.render('login');
});

app.post("/delete/:videoindex", async (req, res) => {
	let {videoindex} = req.params;
	const client = new MongoClient(uri, {serverApi: ServerApiVersion.v1 });
	try {
		await client.connect();
		const db = client.db(database);
		await db.collection(collectionQueue).deleteOne({"_id" : videos[videoindex]._id})
		videos.splice(videoindex, 1);
		res.render("index", {user, videos});
	} catch (e) {
		console.error(e);
	} finally {
		await client.close();
	}
});

app.post("/watch/:videoindex", async (req, res) => {
  const { videoindex } = req.params;
  const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

  try {
    await client.connect();
    const db = client.db(database);
    const videoToWatch = videos[videoindex];

    if (!videoToWatch) {
      return res.status(404).send("Video not found in the queue.");
    }

		await db.collection(collectionQueue).deleteOne({"_id" : videos[0]._id})
    let result = await db.collection(collectionUsers).findOne({ username: user });

    await db.collection(collectionUsers).updateOne(
      { username: user },
      {
        $inc: {
          videosWatched: 1,
          secondsQueued: videoToWatch.length
        }
      }
    );

    result = await db.collection(collectionUsers).findOne({ username: user });

    if (result.longestVideoWatchedLength < videoToWatch.length) {
      await db.collection(collectionUsers).updateOne(
        { username: user },
        {
          $set: {
            longestVideoWatchedLength: videoToWatch.length,
            longestVideoWatched: videoToWatch.title
          }
        }
      );
    }

    videos.splice(0, 1);

    res.render("index", { user, videos });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error watching video.");
  } finally {
    await client.close();
  }
});

app.get('/stats', async (req, res) => {
  const client = new MongoClient(uri, {serverApi: ServerApiVersion.v1 });

  try {
    await client.connect();
    const db = client.db(database);
    let result = await db.collection(collectionUsers).findOne({ username: user });

    let variables = { user, minutes: Math.floor(result.secondsQueued / 60), videos: result.videosWatched, longestVideoWatched: result.longestVideoWatched};
    res.render('stats', variables);
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }

});
