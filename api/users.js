const express = require("express");
const router = express.Router();
const { User, Poll, Ballot, UserFollow } = require("../database");
const { authenticateJWT } = require("../auth");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

router.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long" });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Username must be between 3 and 20 characters" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(409).json({ error: "Username already exists" });
    }

    // Create new user
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ 
      username, 
      passwordHash,
      role: 'user' // Set default role
    });
 const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(201).json({
      message: "User created successfully",
      token,
      user: { 
        id: user.id, 
        username: user.username,
        email: user.email,
        bio: user.bio,
        imageUrl: user.imageUrl,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if user is disabled
    if (user.disabled) {
      return res.status(403).json({ error: "Account is disabled. Please contact support." });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        bio: user.bio,
        imageUrl: user.imageUrl,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

//get all users
router.get("/", async (req, res) => {
  try {
    const users = await User.findAll({ 
      include: [
        Poll, 
        Ballot,
        {
          model: User,
          as: "followers",
          attributes: ["id", "username", "imageUrl"],
          through: { attributes: [] }
        },
        {
          model: User,
          as: "following",
          attributes: ["id", "username", "imageUrl"],
          through: { attributes: [] }
        }
      ],
      attributes: { exclude: ['passwordHash'] }
    });
    res.status(200).send(users);
  } catch (error) {
    console.error("Error fetching users: ", error);
    res.status(500).send("Error fetching users");
  }
});

//get a user by id
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [
        Poll, 
        Ballot,
        {
          model: User,
          as: "followers",
          attributes: ["id", "username", "imageUrl"],
          through: { attributes: ["created_at"] }
        },
        {
          model: User,
          as: "following",
          attributes: ["id", "username", "imageUrl"],
          through: { attributes: ["created_at"] }
        }
      ],
      attributes: { exclude: ['passwordHash'] }
    });
    
    if (!user) {
      return res.status(404).send("User not found");
    }
    
    res.status(200).send(user);
  } catch (error) {
    console.error("Error fetching user by ID:", error);
    res.status(500).send("Error fetching user");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }
    await user.destroy();
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete a user" });
  }
});

//create a user
router.post("/", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const passwordHash = User.hashPassword(password);

    const newUser = { username, email, passwordHash };

    const savedUser = await User.create(newUser);

    res.status(201).send(savedUser);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send("Error creating user");
  }
});

router.patch("/:id", authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;
    const { username, email, bio, imageUrl } = req.body;
    
    console.log("Updating user:", userId, req.body); 
    
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (req.user.id !== parseInt(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized to update this profile" });
    }
    
    const updatedData = {};
    
    if (username !== undefined) {
      const trimmedUsername = username.trim();
      if (trimmedUsername.length < 3) {
        return res.status(400).json({ error: "Username must be at least 3 characters long" });
      }

      const existingUser = await User.findOne({ 
        where: { username: trimmedUsername },
        attributes: ['id']
      });
      
      if (existingUser && existingUser.id !== parseInt(userId)) {
        return res.status(400).json({ error: "Username already taken" });
      }
      
      updatedData.username = trimmedUsername;
    }
    
    if (email !== undefined) {
      const trimmedEmail = email.trim();
      updatedData.email = trimmedEmail === '' ? null : trimmedEmail;
    }
    
    if (bio !== undefined) {
      const trimmedBio = bio.trim();
      updatedData.bio = trimmedBio === '' ? null : trimmedBio;
    }
    
    if (imageUrl !== undefined) {
      const trimmedImageUrl = imageUrl.trim();
      updatedData.imageUrl = trimmedImageUrl === '' ? null : trimmedImageUrl;
    }
    
    await user.update(updatedData);

    const updatedUser = await User.findByPk(userId, {
      attributes: { exclude: ['passwordHash'] }
    });
    
    console.log("User updated successfully:", updatedUser.username);
    
    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ 
      error: "Failed to update profile",
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

//route to get user stats (followers, following, friend count)
router.get("/:id/stats", async (req, res) => {
  try {
    const userId = req.params.id;
    
    const user = await User.findByPk(userId, {
      include: [
        {
          model: User,
          as: "followers",
          attributes: ["id"],
          through: { attributes: [] }
        },
        {
          model: User,
          as: "following",
          attributes: ["id"], 
          through: { attributes: [] }
        },
        {
          model: Poll,
          attributes: ["id"]
        }
      ],
      attributes: ["id", "username"]
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const followingIds = user.following.map(f => f.id);
    const followerIds = user.followers.map(f => f.id);
    const friendIds = followingIds.filter(id => followerIds.includes(id));
    
    res.json({
      userId: user.id,
      username: user.username,
      followersCount: user.followers.length,
      followingCount: user.following.length,
      friendsCount: friendIds.length,
      pollsCount: user.polls.length
    });
    
  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).json({ error: "Failed to fetch user stats" });
  }
});

module.exports = router;
