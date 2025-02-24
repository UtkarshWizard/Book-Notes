import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt, { hash } from "bcryptjs";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

const { Pool } = pg;

const connectionString = process.env.DB_URL; //you can create your postgreSQL server on render.com or Vercel and then they'll give u external URL copy that and paste it here

const db = new Pool({
  connectionString: connectionString, //your External Database URL,you'll find it inside the onrender postgres server dashboard
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initializeDB() {
  try {
      await db.query(`
          CREATE TABLE IF NOT EXISTS users (
              id SERIAL PRIMARY KEY,
              email VARCHAR(255) UNIQUE NOT NULL,
              password TEXT NOT NULL
          );
      `);
      
      await db.query(`
          CREATE TABLE IF NOT EXISTS book (
              id SERIAL PRIMARY KEY,
              bookname VARCHAR(255) NOT NULL,
              author VARCHAR(255),
              coverid VARCHAR(255),
              email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE
          );
      `);

      await db.query(`
          CREATE TABLE IF NOT EXISTS book_review (
              id SERIAL PRIMARY KEY,
              book_id INT REFERENCES book(id) ON DELETE CASCADE,
              review TEXT NOT NULL
          );
      `);

      // console.log("Database initialized successfully.");
  } catch (err) {
      console.error("Error initializing database:", err);
  }
}


db.connect();
initializeDB();

const url = "https://openlibrary.org/search.json";

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie : {
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(passport.initialize());
app.use(passport.session());

//Route to render the home page.
app.get("/", async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const checkemail = await db.query("SELECT * FROM book WHERE email = $1", [
        req.user.email
      ]);

      if (checkemail.rows.length > 0) {
        let sortBy = req.query.sort; //Default sorting by name
        //console.log(sortBy);
        const email = req.user.email;
        //console.log(email);
        let query;

        if (sortBy === "recent") {
          (query = `SELECT * FROM book WHERE email = $1 ORDER BY id DESC`,
            [email]);
        } else if (sortBy === "name") {
          (query = "SELECT * FROM book WHERE email = $1 ORDER BY bookname ASC",[email]);
            
        } else {
          (query = "SELECT * FROM book WHERE email = $1", [email]);
        }
        const result = await db.query(query,[email]);
        const data = result.rows;
        //console.log(data);
        res.render("index.ejs", { data });
      } else {
        res.render("add.ejs");
      }
    } catch (error) {
      res.status(404).send(error.message);
    }
  } else {
    res.redirect("/register");
  }
});

app.get("/register", async (req, res) => {
  res.render("register.ejs");
});

app.get("/login", async (req, res) => {
  res.render("login.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkresult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkresult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.log("Error Hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email,password) VALUES ($1, $2) RETURNING * ",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            res.redirect("/");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post("/login",
    passport.authenticate("local", {
      successRedirect: "/",
      failureRedirect: "/login",
    })
  );

//Route to render the Add Book page.
app.get("/add", async (req, res) => {
  res.render("add.ejs");
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/add",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

//Route to Handle search bar operations on add book page.
app.post("/search-book", async (req, res) => {

  if (req.isAuthenticated) {

    const searchBook = req.body.searchbar;
    let Errmessage = "";

  try {
    const { bookTitle, bookAuthor, coverId } = await fetchData(searchBook);
    //console.log("Searched Book: ", bookTitle);
    //console.log("Cover Id: ", coverId); //Displays information of book and fetch it from api.
    //console.log("Book Author: ", bookAuthor);

    //function to fetch data from api.
    async function fetchData(searchBook) {
      try {
        const response = await fetch(url + `?q=${searchBook}&limit=1`);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        //console.log(data);
        const result = data.docs;
        const bookTitle = result.map((book) => book.title);
        const bookAuthor = result.map((book) =>
          book.author_name ? book.author_name[0] : "Unknown"
        );
        const coverId = result.map((book) => book.cover_i);
        //console.log(coverId);
        return {
          bookTitle: bookTitle,
          bookAuthor: bookAuthor,
          coverId: coverId,
        };
      } catch (error) {
        console.error("Error fetching data: ", error);
      }
    }

    //Way to eneter book details into databse.

    try {
      const bookTitleValue = bookTitle[0];
      if (bookTitleValue) {
        const BookCheck = await db.query(
          "SELECT * FROM book WHERE bookname = $1 AND email = $2",
          [bookTitleValue,req.user.email]
        );
        if (BookCheck.rows.length > 0) {
          Errmessage = "This Book Has Already Been Added";
        } else {
          const bookAuthorValue = bookAuthor[0];
          const coverIdValue = coverId[0]; //The Value of coverId was returning a string array so we took only 1st value.
          await db.query(
            "INSERT INTO book (bookname,author,coverid,email) VALUES ($1,$2,$3,$4)",
            [bookTitleValue, bookAuthorValue, coverIdValue, req.user.email]
          );
        }
      } else {
        Errmessage = "No Book Title Found";
      }
    } catch (error) {
      console.error("Error checking existence in the database:", error);
      res.status(500).send("Internal Server Error");
    }

    res.render("add.ejs", {
      title: bookTitle,
      author: bookAuthor,
      cover: coverId,
      showAdditionalInput: true,
      Errmessage,
    });
  } catch (error) {
    res.status(500).send("Internal Server Error");
  }
  } else {
    res.redirect("/")
  }
  
});

//Route to add the data from add book page to home page by clicking button.
app.post("/addbook", async (req, res) => {
  let Errmessage = "";
  const BookReview = req.body.BookReview;

  try {
    if (BookReview.length > 0) {
      // Insert the book review into the book_review table
      await db.query(
        "INSERT INTO book_review (book_id, review) VALUES ((SELECT MAX(id) FROM book), $1)",
        [BookReview]
      );

      res.redirect("/");
    } else {
      Errmessage = "Oops! You Forgot to Write Your Learnings.";
      res.render("add.ejs", { Errmessage });
    }
  } catch (error) {
    console.error("Error inserting book review:", error);
    res.status(500).send("Internal Server Error");
  }
});

// To display details of the book when specific book is selected.
app.get("/bookdetail/:id", async (req, res) => {
  try {
    const CurrentBookId = req.params.id;

    const bookResult = await db.query("SELECT * FROM book WHERE id = $1", [
      CurrentBookId,
    ]);
    const book = bookResult.rows[0];

    const reviewResult = await db.query(
      "Select * FROM book_review WHERE book_id = $1",
      [CurrentBookId]
    );
    const bookReview = reviewResult.rows[0];

    res.render("bookdetail.ejs", { book, bookReview });
  } catch (error) {
    console.error("Error fetching book details:", error);
    res.status(500).send("Internal Server Error");
  }
});

//To delete book and review from database
app.post("/delete-book", async (req, res) => {
  const id = req.body.id;
  console.log(id);
  try {
    await db.query("DELETE FROM book_review WHERE book_id = $1", [id]);
    await db.query("DELETE FROM book WHERE id = $1", [id]);
    res.redirect("/");
  } catch (error) {
    console.error("Error deleting book:", error);
    res.status(500).send("Internal Server Error");
  }
});

// To upadate the learnings
app.post("/update-learnings", async (req, res) => {
  const id = req.body.id;
  const updatedReview = req.body.updatedReview;

  try {
    await db.query("UPDATE book_review SET review = $1 WHERE book_id = $2", [
      updatedReview,
      id,
    ]);
    res.redirect(`/bookdetail/${id}`); // Redirect to the same book detail page after updating
  } catch (error) {
    console.error("Error updating learnings:", error);
    res.status(500).send("Internal Server Error");
  }
});

passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [
        username,
      ]);

      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing Passwords:", err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.use("google", new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://book-notes-xytd.onrender.com/auth/google/add",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
  },
  async (accessToken, refreshToken , profile, cb) => {
    try {
      console.log(profile);
      const result = await db.query("SELECT * FROM users WHERE email = $1",[profile.email]);

      if (result.rows.length === 0) {
        const newUser = await db.query("INSERT INTO users (email,password) VALUES ($1,$2)",[profile.email,"google"]);
        return cb(null, newUser.rows[0]);
      } else {
        return cb(null, result.rows[0]);
      }
    } catch (err) {
      return cb(err)
    };
  }
))

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
